/**
 * Vector tiles of the map's route lines and stops, cut in the feed worker.
 *
 * Each layer is a geojson-vt index fed one feature at a time from the
 * store, so no whole-feed GeoJSON is ever held. Tiles go out as MVT bytes;
 * the main thread hands them to MapLibre through a custom protocol.
 */

import { GeoJSONVT } from '@maplibre/geojson-vt';
import { fromGeojsonVt } from '@maplibre/vt-pbf';
import type { FeedStore } from 'gtfs-zone-web-common/gtfs/store/feed-store';
import { routeSortKey } from 'gtfs-zone-web-common/gtfs/route-sort';
import {
  routeColor,
  casingColor,
} from 'gtfs-zone-web-common/gtfs/route-colors';
import { CONFIG } from '../config';
import type { Pathways, Stops } from '../types/gtfs-entities';
import { buildStopCoordResolver, hasValidCoords } from '../utils/stop-coords';
import { routeLines } from './route-lines';

export type MapTileLayer = 'routes' | 'stops';

export interface MapRoutesBuilt {
  /** [west, south, east, north] of each drawn route's lines. */
  bounds: Record<string, [number, number, number, number]>;
  lines: number;
}

const EXTENT = 4096;

/**
 * An array-like that makes feature `i` only when geojson-vt asks for it, so
 * the whole collection never exists at once.
 */
function lazyFeatures(
  length: number,
  make: (i: number) => GeoJSON.Feature | null
): GeoJSON.Feature[] {
  return new Proxy([] as GeoJSON.Feature[], {
    get(target, prop, receiver) {
      if (prop === 'length') {
        return length;
      }
      if (typeof prop === 'string' && /^\d+$/.test(prop)) {
        return make(Number(prop));
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

function locationType(stop: Stops): number {
  return parseInt(String(stop.location_type ?? '0'), 10) || 0;
}

export class MapTiles {
  private indexes: Partial<Record<MapTileLayer, GeoJSONVT>> = {};

  /** Index every route as one MultiLineString of its simplified lines. */
  buildRoutes(store: FeedStore): MapRoutesBuilt {
    const t0 = performance.now();
    // Free the old index first so a re-index never holds two.
    delete this.indexes.routes;
    const routes = new Map<string, { color: string; type: string }>();
    if (store.hasTable('routes')) {
      store.scan(
        'routes',
        ['route_id', 'route_color', 'route_type'],
        ([id, color, type]) => {
          routes.set(id, { color, type });
        }
      );
    }
    const geometries = routeLines(store).filter((g) => routes.has(g.routeId));
    const bounds: MapRoutesBuilt['bounds'] = {};
    let lines = 0;
    for (const g of geometries) {
      bounds[g.routeId] = g.bbox;
      lines += g.lineStarts.length;
    }
    const features = lazyFeatures(geometries.length, (i) => {
      const g = geometries[i];
      const route = routes.get(g.routeId)!;
      const total = g.coords.length / 2;
      const coordinates: [number, number][][] = [];
      for (let l = 0; l < g.lineStarts.length; l++) {
        const from = g.lineStarts[l];
        const to = l + 1 < g.lineStarts.length ? g.lineStarts[l + 1] : total;
        const line: [number, number][] = [];
        for (let p = from; p < to; p++) {
          line.push([g.coords[p * 2], g.coords[p * 2 + 1]]);
        }
        coordinates.push(line);
      }
      const color = routeColor(g.routeId, route.color);
      return {
        type: 'Feature',
        geometry: { type: 'MultiLineString', coordinates },
        properties: {
          route_id: g.routeId,
          color,
          colorDark: casingColor(color),
          // line-sort-key: mode rank blended with the route's line count.
          sortKey: routeSortKey(route.type, g.lineStarts.length),
        },
      };
    });
    this.indexes.routes = new GeoJSONVT(
      { type: 'FeatureCollection', features },
      {
        maxZoom: CONFIG.MAP_ROUTES_MAXZOOM,
        tolerance: CONFIG.MAP_TILE_TOLERANCE,
        buffer: CONFIG.MAP_TILE_BUFFER,
        extent: EXTENT,
      }
    );
    console.log(
      `[MapTiles] routes: ${geometries.length} routes, ${lines} lines indexed in ${Math.round(performance.now() - t0)}ms`
    );
    return { bounds, lines };
  }

  /**
   * Index every stop that has a drawable position: its own coords, or one
   * resolved from its station and pathways (see buildStopCoordResolver).
   */
  buildStops(store: FeedStore): { stops: number } {
    const t0 = performance.now();
    delete this.indexes.stops;
    const rows = (table: string) =>
      store.hasTable(table) ? store.rows(table).map((r) => r.row) : [];
    const stops = rows('stops') as unknown as Stops[];
    const pathways = rows('pathways') as unknown as Pathways[];
    const byId = new Map<string, Stops>();
    for (const s of stops) {
      byId.set(String(s.stop_id), s);
    }
    const resolve = buildStopCoordResolver(stops, pathways);

    // The station a stop belongs to: itself for a station, else the nearest
    // location_type=1 ancestor, else ''.
    const stationOf = (stop: Stops): string => {
      if (locationType(stop) === 1) {
        return String(stop.stop_id);
      }
      let current = stop;
      for (let i = 0; i < 5; i++) {
        const parent = current.parent_station
          ? byId.get(String(current.parent_station))
          : undefined;
        if (!parent) {
          return '';
        }
        if (locationType(parent) === 1) {
          return String(parent.stop_id);
        }
        current = parent;
      }
      return '';
    };

    let skipped = 0;
    let drawn = 0;
    const features = lazyFeatures(stops.length, (i) => {
      const stop = stops[i];
      const coord = resolve(String(stop.stop_id));
      if (!coord) {
        const type = locationType(stop);
        if (!hasValidCoords(stop) && type !== 3 && type !== 4) {
          skipped++;
        }
        return null;
      }
      drawn++;
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: coord },
        properties: {
          stop_id: String(stop.stop_id),
          location_type: locationType(stop),
          parent_station: stop.parent_station ?? '',
          station_id: stationOf(stop),
          has_own_coords: hasValidCoords(stop),
        },
      };
    });
    this.indexes.stops = new GeoJSONVT(
      { type: 'FeatureCollection', features },
      {
        maxZoom: CONFIG.MAP_STOPS_MAXZOOM,
        buffer: CONFIG.MAP_TILE_BUFFER,
        extent: EXTENT,
      }
    );
    if (skipped > 0) {
      console.warn(
        `[MapTiles] ${skipped} stops have no resolvable coords and are not drawn`
      );
    }
    console.log(
      `[MapTiles] stops: ${drawn} indexed in ${Math.round(performance.now() - t0)}ms`
    );
    return { stops: drawn };
  }

  /** One tile as MVT bytes (layer named after `layer`), or null when empty. */
  tile(
    layer: MapTileLayer,
    z: number,
    x: number,
    y: number
  ): Uint8Array | null {
    const index = this.indexes[layer];
    const tile = index?.getTile(z, x, y);
    if (!tile || tile.features.length === 0) {
      return null;
    }
    return fromGeojsonVt({ [layer]: tile }, { version: 2, extent: EXTENT });
  }

  clear(): void {
    this.indexes = {};
  }
}
