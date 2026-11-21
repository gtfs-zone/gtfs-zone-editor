/**
 * Area membership, including the station-to-platform inheritance rule.
 *
 * `stop_areas.txt` only ever names stops explicitly, but the spec gives a row
 * naming a station a wider meaning: every platform of that station is in the
 * area too, "unless a platform is assigned to another area". So the areas a
 * platform is actually in cannot be read off its own rows alone.
 */

import type { EditorFeed } from '../feed/editor-feed';

export interface EffectiveArea {
  area_id: string;
  /** The station this membership came from, when it was not assigned directly. */
  inheritedFrom?: string;
}

/** `location_type` as a number, treating the empty value as 0 per the spec. */
export function stopLocationType(stop: Record<string, unknown>): number {
  const raw = stop.location_type;
  if (typeof raw === 'number') {
    return raw;
  }
  const text = String(raw ?? '').trim();
  return parseInt(text, 10) || 0;
}

/**
 * Only stops (0) and stations (1) may be assigned to areas. Entrances, generic
 * nodes and boarding areas may not.
 */
export function canStopHaveAreas(stop: Record<string, unknown>): boolean {
  const type = stopLocationType(stop);
  return type === 0 || type === 1;
}

function uniqueAreaIds(rows: readonly Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    const area_id = String(row.area_id ?? '').trim();
    if (area_id !== '') {
      seen.add(area_id);
    }
  }
  return Array.from(seen);
}

/** The `stop_areas` rows naming this stop directly. */
export function getExplicitAreasForStop(
  feed: EditorFeed,
  stop_id: string
): string[] {
  return uniqueAreaIds(
    feed.table('stop_areas').filter((row) => row.stop_id === stop_id)
  );
}

/**
 * Every area this stop is in, explicit rows first.
 *
 * A platform with any explicit row uses only its explicit rows: assigning a
 * platform to an area is what the spec means by overriding the station's, so
 * the two sets never mix.
 */
export function getEffectiveAreasForStop(
  feed: EditorFeed,
  stop_id: string
): EffectiveArea[] {
  const explicit = getExplicitAreasForStop(feed, stop_id);
  if (explicit.length > 0) {
    return explicit.map((area_id) => ({ area_id }));
  }

  const stop = feed.byKey('stops', stop_id);
  if (!stop || stopLocationType(stop) !== 0) {
    return [];
  }
  const parent_station = String(stop.parent_station ?? '').trim();
  if (parent_station === '') {
    return [];
  }

  const inherited = getExplicitAreasForStop(feed, parent_station);
  return inherited.map((area_id) => ({
    area_id,
    inheritedFrom: parent_station,
  }));
}
