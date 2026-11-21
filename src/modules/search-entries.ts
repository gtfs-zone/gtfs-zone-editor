/**
 * Turns the loaded feed into grouped search entries for `SearchController`.
 *
 * The payload wraps a `PageState`, so selecting a result can go straight
 * through the normal navigation path and leave the sidebar and URL correct.
 */

import { GTFS_TABLES } from '../types/gtfs';
import type { PlacePayload } from 'gtfs-zone-web-common/map/place-search';
import type { PageState } from '../types/page-state';
import {
  getAgencyDisplay,
  getRouteDisplay,
  getStopDisplay,
} from '../utils/entity-display';
import type { EditorFeed, FeedRow } from '../feed/editor-feed';
import { normalizeAgencyId } from '../utils/agency-helpers';
import { listZones, zoneName } from './zone-store';
import {
  neutralMarker,
  routeMarker,
  stopMarker,
  type SearchEntry,
  type SearchGroup,
} from 'gtfs-zone-web-common/ui/search-controller';
import { t } from '../i18n/messages';

/** Non-empty values only, so the haystack has no runs of blanks to match into. */
function haystack(...parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/** A search pick: an entity page, or a place from the remote search. */
export type SearchPayload = { kind: 'entity'; state: PageState } | PlacePayload;

type Entries = SearchEntry<SearchPayload>[];

interface GroupEntries {
  stops: Entries;
  routes: Entries;
  agencies: Entries;
  zones: Entries;
  locationGroups: Entries;
}

let memo: {
  generation: number;
  version: number;
  entries: GroupEntries;
} | null = null;

/**
 * The feed's search groups. Entry arrays are built once per feed generation
 * and version, so the controller's haystack cache hits on every keystroke.
 */
export function buildSearchGroups(
  feed: EditorFeed
): SearchGroup<SearchPayload>[] {
  if (!feed.isOpen) {
    return [];
  }
  if (
    memo?.generation !== feed.feedGeneration ||
    memo.version !== feed.version
  ) {
    memo = {
      generation: feed.feedGeneration,
      version: feed.version,
      entries: buildEntries(feed),
    };
  }
  const { stops, routes, agencies, zones, locationGroups } = memo.entries;
  return [
    { label: t('search.stops'), entries: stops },
    { label: t('search.routes'), entries: routes },
    { label: t('search.agencies'), entries: agencies },
    { label: t('search.zones'), entries: zones },
    { label: t('search.locationGroups'), entries: locationGroups },
  ];
}

function buildEntries(feed: EditorFeed): GroupEntries {
  const table = (name: string): readonly FeedRow[] =>
    feed.table(name.replace(/\.txt$/, ''));
  const entries: GroupEntries = {
    stops: [],
    routes: [],
    agencies: [],
    zones: [],
    locationGroups: [],
  };

  for (const stop of table(GTFS_TABLES.STOPS)) {
    const stop_id = stop['stop_id'];
    if (!stop_id) {
      continue;
    }
    entries.stops.push({
      payload: { kind: 'entity', state: { type: 'stop', stop_id } },
      icon: stopMarker(stop['location_type']),
      primary: getStopDisplay(stop).primary,
      secondary: stop['stop_code'] || stop_id,
      haystack: haystack(
        stop['stop_name'],
        stop_id,
        stop['stop_code'],
        stop['stop_desc']
      ),
      // Stations first within the stops group.
      priority: Number(stop['location_type']) === 1 ? 0 : 1,
    });
  }

  for (const route of table(GTFS_TABLES.ROUTES)) {
    const route_id = route['route_id'];
    if (!route_id) {
      continue;
    }
    const display = getRouteDisplay(route);
    entries.routes.push({
      payload: { kind: 'entity', state: { type: 'route', route_id } },
      icon: routeMarker(route['route_color']),
      primary: display.primary,
      secondary:
        route['route_long_name'] && route['route_long_name'] !== display.primary
          ? route['route_long_name']
          : route_id,
      haystack: haystack(
        route['route_short_name'],
        route['route_long_name'],
        route_id,
        route['route_desc']
      ),
    });
  }

  for (const agency of table(GTFS_TABLES.AGENCY)) {
    // An empty agency_id is the feed's single agency, keyed as ''
    const agency_id = normalizeAgencyId(agency['agency_id']);
    entries.agencies.push({
      payload: { kind: 'entity', state: { type: 'agency', agency_id } },
      icon: neutralMarker(),
      primary: getAgencyDisplay(agency).primary,
      secondary: agency_id,
      haystack: haystack(agency['agency_name'], agency_id),
    });
  }

  for (const feature of listZones(feed)) {
    const location_id = String(feature.id);
    const name = zoneName(feature);
    entries.zones.push({
      payload: { kind: 'entity', state: { type: 'zone', location_id } },
      icon: neutralMarker(),
      primary: name || location_id,
      secondary: location_id,
      haystack: haystack(name, location_id, t('search.zoneTerms')),
    });
  }

  for (const group of table(GTFS_TABLES.LOCATION_GROUPS)) {
    const location_group_id = group['location_group_id'];
    if (!location_group_id) {
      continue;
    }
    const name = group['location_group_name'];
    entries.locationGroups.push({
      payload: {
        kind: 'entity',
        state: { type: 'location_group', location_group_id },
      },
      icon: neutralMarker(),
      primary: name || location_group_id,
      secondary: location_group_id,
      haystack: haystack(name, location_group_id, t('search.groupTerms')),
    });
  }

  return entries;
}
