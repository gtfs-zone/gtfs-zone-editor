/**
 * Owners of IDs in the namespace stops.txt, locations.geojson and
 * location_groups.txt share
 */

import type { EditorFeed } from '../feed/editor-feed';
import { getZoneFeatures } from '../modules/zone-store';
import { t } from '../i18n/messages';

/** Every id already claimed by stops.txt or locations.geojson, and by which. */
export function readIdOwners(feed: EditorFeed): Map<string, string> {
  const owners = new Map<string, string>();
  for (const stop of feed.table('stops')) {
    const id = (stop.stop_id ?? '').trim();
    if (id !== '') {
      owners.set(id, t('ids.ownerStop'));
    }
  }
  for (const feature of getZoneFeatures(feed)) {
    const id = String(feature.id ?? '').trim();
    if (id !== '') {
      owners.set(id, t('ids.ownerZone'));
    }
  }
  return owners;
}

/**
 * Every id a new stop or zone may not take.
 *
 * `readIdOwners` covers stops and existing zones, which is all the location
 * group validator may see (it must not flag a row against its own id). A new
 * stop or zone is checked against the whole namespace, so the location groups
 * go on top.
 */
export function readNewLocationIdOwners(feed: EditorFeed): Map<string, string> {
  const owners = readIdOwners(feed);
  for (const group of feed.table('location_groups')) {
    const id = (group.location_group_id ?? '').trim();
    if (id !== '' && !owners.has(id)) {
      owners.set(id, t('ids.ownerGroup'));
    }
  }
  return owners;
}

/** The message for an id `owners` already holds, or null if it is free. */
export function locationIdClash(
  owners: Map<string, string>,
  id: string
): string | null {
  const owner = owners.get(id);
  return owner ? t('ids.taken', { id, owner }) : null;
}
