/**
 * Bulk trip deletion.
 *
 * Deletes trips and the frequencies rows that belong to them as one patch, so
 * the whole run is one undo step. The caller picks the trips; this does not
 * touch stop_times, so it is meant for trips that have none.
 */

import type { EditorFeed } from '../feed/editor-feed';
import { deleteOp } from '../feed/patch-build';
import { t } from '../i18n/messages';

export interface TripDeleteResult {
  /** Trips deleted. */
  trips: number;
  /** frequencies rows deleted along with them. */
  frequencies: number;
  /** Trip ids that no longer exist, so there was nothing to delete. */
  missing: number;
}

export async function deleteTrips(
  trip_ids: string[],
  feed: EditorFeed
): Promise<TripDeleteResult> {
  const wanted = [...new Set(trip_ids)];
  const result: TripDeleteResult = { trips: 0, frequencies: 0, missing: 0 };

  const found = await feed.where('trips', [{ col: 'trip_id', in: wanted }]);
  const foundIds = new Set(found.map((trip) => trip.trip_id));
  result.missing = wanted.filter((id) => !foundIds.has(id)).length;

  const frequencies = feed
    .table('frequencies')
    .filter((row) => foundIds.has(row.trip_id ?? ''));

  console.log(
    `[TripDelete] deleting ${found.length} trips and ${frequencies.length} frequencies rows`
  );
  const applied = await feed.apply(
    [
      ...frequencies.map((row) => deleteOp('frequencies', row)),
      ...found.map((trip) => deleteOp('trips', trip)),
    ],
    t('fix.deleteTripsLabel', { count: found.length })
  );
  if (!applied) {
    console.log('[TripDelete] nothing to delete');
    return result;
  }

  result.trips = found.length;
  result.frequencies = frequencies.length;
  return result;
}

/** The one-line notification text for a finished run. */
export function describeTripDelete(result: TripDeleteResult): string {
  const parts = [t('fix.deletedTrips', { count: result.trips })];
  if (result.frequencies > 0) {
    parts.push(t('fix.removedFrequencies', { count: result.frequencies }));
  }
  if (result.missing > 0) {
    parts.push(t('fix.skippedTrips', { count: result.missing }));
  }
  return parts.join('; ');
}
