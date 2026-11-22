/**
 * Suggested `<prefix>_<n>` IDs for new entities
 */

import type { EditorFeed } from '../feed/editor-feed';
import { getNaturalKeyField } from 'gtfs-zone-web-common/gtfs/spec/primary-keys';

/** First `<prefix>_<n>` not in `taken`, counting from 1. */
export function firstFreeId(prefix: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  let n = 1;
  while (used.has(`${prefix}_${n}`)) {
    n += 1;
  }
  return `${prefix}_${n}`;
}

/**
 * First free `<prefix>_<n>` ID in a naturally-keyed table, counting from 1.
 * `alsoTaken` holds IDs in use outside the table's own rows.
 */
export async function nextEntityId(
  feed: EditorFeed,
  tableName: string,
  prefix: string,
  alsoTaken: Iterable<string> = []
): Promise<string> {
  const keyField = getNaturalKeyField(tableName);
  if (!keyField) {
    throw new Error(`[nextEntityId] ${tableName} has no natural key`);
  }

  return firstFreeId(prefix, [
    ...(await feed.distinct(tableName, keyField)),
    ...alsoTaken,
  ]);
}

/**
 * First free `service_<n>`, skipping IDs held only by `calendar_dates` rows.
 */
export async function nextServiceId(feed: EditorFeed): Promise<string> {
  return nextEntityId(
    feed,
    'calendar',
    'service',
    await feed.distinct('calendar_dates', 'service_id')
  );
}
