/**
 * Read and write access to on-demand zones (locations.geojson).
 *
 * locations.geojson is a non-table entry of the feed, mirrored as text by
 * `EditorFeed` and parsed here once per text. Every write replaces the whole
 * FeatureCollection, as one patch (or as a file change inside a caller's
 * batch, see `zoneFileChange`).
 */

import type { EditorFeed } from '../feed/editor-feed';
import type { FileChange } from '../types/patch';
import { t } from '../i18n/messages';

export const LOCATIONS_GEOJSON = 'locations.geojson';

/**
 * A stored locations.geojson feature.
 *
 * The geometry is nullable because a feed can arrive carrying a feature the
 * reference forbids, and dropping it on read would delete it on the next write.
 * `listZones` is the filtered view for everything that draws or lists zones.
 */
export type ZoneFeature = GeoJSON.Feature<
  GeoJSON.Polygon | GeoJSON.MultiPolygon | null
>;

/** A zone that passed `hasZoneGeometry`, so its geometry can be drawn. */
export type DrawnZoneFeature = GeoJSON.Feature<
  GeoJSON.Polygon | GeoJSON.MultiPolygon
>;

/** [west, south, east, north] */
export type ZoneBounds = [number, number, number, number];

let parsed: { text: string; collection: GeoJSON.FeatureCollection } | null =
  null;

/** The stored FeatureCollection, or an empty one when the feed has no zones. */
export function getZoneCollection(feed: EditorFeed): GeoJSON.FeatureCollection {
  const text = feed.isOpen ? feed.file(LOCATIONS_GEOJSON) : null;
  if (text === null) {
    return { type: 'FeatureCollection', features: [] };
  }
  if (parsed?.text !== text) {
    let stored: Partial<GeoJSON.FeatureCollection>;
    try {
      stored = JSON.parse(text) as Partial<GeoJSON.FeatureCollection>;
    } catch (err) {
      console.error('[ZoneStore] locations.geojson is not valid JSON', err);
      stored = {};
    }
    const collection = Array.isArray(stored.features)
      ? (stored as GeoJSON.FeatureCollection)
      : { type: 'FeatureCollection' as const, features: [] };
    parsed = { text, collection };
  }
  return parsed.collection;
}

/**
 * Every stored feature, exactly as the file carries it.
 *
 * Unfiltered on purpose: a zone write rewrites the whole feature array from
 * this list, so anything skipped here would be deleted from the file by the
 * next unrelated edit. Use `listZones` to list or draw zones.
 */
export function getZoneFeatures(feed: EditorFeed): ZoneFeature[] {
  return getZoneCollection(feed).features as ZoneFeature[];
}

/** Whether the feature carries a polygonal geometry with coordinates. */
export function hasZoneGeometry(feature: ZoneFeature): boolean {
  const type = feature.geometry?.type;
  if (type !== 'Polygon' && type !== 'MultiPolygon') {
    return false;
  }
  return positionsOf(feature).length > 0;
}

/**
 * The zones that are usable as zones: an id and a real geometry.
 *
 * For the map, search and the pickers. A feature that fails either test is
 * reported by the validator and stays reachable from the On-Demand modal's
 * Zones pane, which reads the raw collection.
 */
export function listZones(feed: EditorFeed): DrawnZoneFeature[] {
  const features: DrawnZoneFeature[] = [];
  for (const feature of getZoneFeatures(feed)) {
    if (feature.id === undefined || feature.id === null || feature.id === '') {
      console.warn('[ZoneStore] Skipping locations.geojson feature with no id');
      continue;
    }
    if (!hasZoneGeometry(feature)) {
      console.warn(
        `[ZoneStore] Skipping locations.geojson feature ${String(feature.id)}: geometry is ${String(feature.geometry?.type)}, expected Polygon or MultiPolygon with coordinates`
      );
      continue;
    }
    features.push(feature as DrawnZoneFeature);
  }
  return features;
}

/**
 * One feature by id, geometry or not, so a feature the validator flagged can
 * be opened and repaired on its zone page.
 */
export function getZoneFeature(
  feed: EditorFeed,
  location_id: string
): ZoneFeature | null {
  return (
    getZoneFeatures(feed).find((f) => String(f.id ?? '') === location_id) ??
    null
  );
}

export function zoneName(feature: ZoneFeature): string {
  const properties = (feature.properties ?? {}) as Record<string, unknown>;
  return properties.stop_name ? String(properties.stop_name) : '';
}

export function zoneDescription(feature: ZoneFeature): string {
  const properties = (feature.properties ?? {}) as Record<string, unknown>;
  return properties.stop_desc ? String(properties.stop_desc) : '';
}

/** Every position in a polygon or multipolygon, rings included. */
function positionsOf(feature: ZoneFeature): GeoJSON.Position[] {
  const geometry = feature.geometry;
  if (!geometry) {
    return [];
  }
  if (geometry.type === 'Polygon') {
    return geometry.coordinates.flat();
  }
  return geometry.coordinates.flat(2);
}

export function zoneVertexCount(feature: ZoneFeature): number {
  return positionsOf(feature).length;
}

export function zoneBounds(feature: ZoneFeature): ZoneBounds | null {
  const positions = positionsOf(feature);
  if (positions.length === 0) {
    return null;
  }
  let [west, south] = positions[0];
  let east = west;
  let north = south;
  for (const [lng, lat] of positions) {
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return [west, south, east, north];
}

export interface ZoneMergeResult {
  features: ZoneFeature[];
  added: string[];
  updated: string[];
  removed: string[];
}

/**
 * Merge edited features back over the stored ones.
 *
 * geojson.io does not preserve unknown properties, so an incoming feature
 * replaces geometry and overlays its own properties on top of the stored ones
 * rather than overwriting the whole feature. `removeMissing` is for a
 * whole-collection round trip, where a feature the user deleted in geojson.io
 * should disappear here too; it must stay false when only one zone was sent
 * out, or the round trip would delete every other zone in the feed.
 */
export function mergeZoneFeatures(
  current: ZoneFeature[],
  incoming: GeoJSON.Feature[],
  removeMissing: boolean
): ZoneMergeResult {
  const incomingById = new Map<string, GeoJSON.Feature>();
  for (const feature of incoming) {
    const id =
      feature.id !== undefined && feature.id !== null && feature.id !== ''
        ? String(feature.id)
        : String(
            (feature.properties as Record<string, unknown> | null)?.id ?? ''
          );
    if (!id) {
      throw new Error(t('geo.pastedNoId'));
    }
    if (incomingById.has(id)) {
      throw new Error(t('geo.duplicateId', { id }));
    }
    // geojson.io returns a feature it could not draw with a null geometry.
    // Storing that is how a zone loses its polygon, so refuse it here.
    const type = feature.geometry?.type;
    if (type !== 'Polygon' && type !== 'MultiPolygon') {
      throw new Error(t('geo.notPolygon', { id, type: String(type) }));
    }
    incomingById.set(id, feature);
  }

  const result: ZoneFeature[] = [];
  const updated: string[] = [];
  const removed: string[] = [];

  for (const feature of current) {
    const id = String(feature.id ?? '');
    const edited = incomingById.get(id);
    if (!edited) {
      if (removeMissing) {
        removed.push(id);
      } else {
        result.push(feature);
      }
      continue;
    }
    incomingById.delete(id);
    result.push({
      ...feature,
      id,
      properties: {
        ...(feature.properties ?? {}),
        ...(edited.properties ?? {}),
      },
      geometry: edited.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon,
    });
    updated.push(id);
  }

  const added: string[] = [];
  for (const [id, feature] of incomingById) {
    result.push({
      type: 'Feature',
      id,
      properties: { ...(feature.properties ?? {}) },
      geometry: feature.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon,
    });
    added.push(id);
  }

  return { features: result, added, updated, removed };
}

/**
 * The file change that replaces the zone features with `features`, for a
 * caller's own batch. Keeps the collection's other members.
 */
export function zoneFileChange(
  feed: EditorFeed,
  features: ZoneFeature[]
): FileChange {
  const collection = getZoneCollection(feed);
  return {
    name: LOCATIONS_GEOJSON,
    before: feed.file(LOCATIONS_GEOJSON),
    after: JSON.stringify({
      ...collection,
      type: 'FeatureCollection',
      features,
    }),
  };
}

/** Replace the zone features as one patch. */
export async function writeZoneFeatures(
  feed: EditorFeed,
  features: ZoneFeature[]
): Promise<void> {
  const before = getZoneFeatures(feed).length;
  await feed.editFile(LOCATIONS_GEOJSON, zoneFileChange(feed, features).after);
  console.log(
    `[ZoneStore] Wrote ${features.length} zone features (was ${before})`
  );
}

/**
 * Overlay properties onto one zone's feature.
 *
 * An empty value removes the property rather than storing `""`: the exported
 * locations.geojson should carry a `stop_desc` only when there is one.
 */
export async function setZoneProperties(
  feed: EditorFeed,
  location_id: string,
  properties: Record<string, string>
): Promise<void> {
  const features = getZoneFeatures(feed);
  const target = features.find((f) => String(f.id ?? '') === location_id);
  if (!target) {
    throw new Error(t('geo.zoneGone', { id: location_id }));
  }

  const merged = { ...(target.properties ?? {}) } as Record<string, unknown>;
  for (const [key, value] of Object.entries(properties)) {
    if (value === '') {
      delete merged[key];
    } else {
      merged[key] = value;
    }
  }

  const next = features.map((feature) =>
    feature === target ? { ...feature, properties: merged } : feature
  );
  await writeZoneFeatures(feed, next);
  console.log(`[ZoneStore] Updated properties of zone ${location_id}`);
}
