/**
 * Breadcrumb names, read from the mirrored feed tables.
 */

import type { BreadcrumbLookup, StopAncestor } from './breadcrumbs';
import type { EditorFeed, FeedRow } from '../feed/editor-feed';
import { getStopDisplay, renderOptionLabel } from '../utils/entity-display';
import {
  normalizeAgencyId,
  UNSPECIFIED_AGENCY_ID,
} from '../utils/agency-helpers';
import { getZoneFeature, zoneName } from './zone-store';

/** A stops row carries location_type as a string; blank means a plain stop. */
function parseLocationType(value: string | undefined): number | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stopAncestor(stop: FeedRow): StopAncestor {
  return {
    stop_id: stop.stop_id,
    label: renderOptionLabel(getStopDisplay(stop)),
    location_type: parseLocationType(stop.location_type),
  };
}

/** Outermost station first, excluding the stop itself. */
function stopAncestors(feed: EditorFeed, stop_id: string): StopAncestor[] {
  const chain: StopAncestor[] = [];
  let current = feed.byKey('stops', stop_id);
  for (let i = 0; i < 5 && current; i++) {
    const parentId = current.parent_station ?? '';
    const parent = parentId ? feed.byKey('stops', parentId) : null;
    if (!parent) {
      break;
    }
    chain.push(stopAncestor(parent));
    current = parent;
  }
  return chain.reverse();
}

export function createGTFSBreadcrumbLookup(feed: EditorFeed): BreadcrumbLookup {
  const open = () => feed.isOpen;
  return {
    getAgencyName: async (agency_id) => {
      const agency = open() ? feed.byKey('agency', agency_id) : null;
      return agency?.agency_name || `Agency ${agency_id}`;
    },
    getRouteName: async (route_id) => {
      const route = open() ? feed.byKey('routes', route_id) : null;
      return (
        route?.route_short_name || route?.route_long_name || `Route ${route_id}`
      );
    },
    getStopName: async (stop_id) => {
      const stop = open() ? feed.byKey('stops', stop_id) : null;
      return stop ? renderOptionLabel(getStopDisplay(stop)) : `Stop ${stop_id}`;
    },
    getStopLocationType: async (stop_id) => {
      const stop = open() ? feed.byKey('stops', stop_id) : null;
      return stop ? parseLocationType(stop.location_type) : undefined;
    },
    getStopAncestors: async (stop_id) =>
      open() ? stopAncestors(feed, stop_id) : [],
    getPathwayAncestors: async (pathway_id) => {
      const pathway = open() ? feed.byKey('pathways', pathway_id) : null;
      const from = pathway?.from_stop_id ?? '';
      if (!from) {
        return [];
      }
      const fromStop = feed.byKey('stops', from);
      return [
        ...stopAncestors(feed, from),
        fromStop
          ? stopAncestor(fromStop)
          : { stop_id: from, label: `Stop ${from}`, location_type: undefined },
      ];
    },
    getZoneName: async (location_id) => {
      const feature = open() ? getZoneFeature(feed, location_id) : null;
      return (feature && zoneName(feature)) || location_id;
    },
    getLocationGroupName: async (location_group_id) => {
      const group = open()
        ? feed.byKey('location_groups', location_group_id)
        : null;
      return group?.location_group_name || location_group_id;
    },
    getAgencyIdForRoute: async (route_id) => {
      const route = open() ? feed.byKey('routes', route_id) : null;
      if (!route) {
        return 'default';
      }
      const agency_id = normalizeAgencyId(route.agency_id);
      if (agency_id !== UNSPECIFIED_AGENCY_ID) {
        return agency_id;
      }
      // A route without agency_id belongs to the feed's single agency
      const agencies = feed.table('agency');
      return agencies.length === 1
        ? normalizeAgencyId(agencies[0].agency_id)
        : 'default';
    },
  };
}
