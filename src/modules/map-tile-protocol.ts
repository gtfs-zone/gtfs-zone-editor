import { addProtocol } from 'maplibre-gl';
import type {
  Map as MapLibreMap,
  MapSourceDataEvent,
  VectorTileSource,
} from 'maplibre-gl';
import type { EditorFeed } from '../feed/editor-feed';
import type { MapTileLayer } from '../feed/map-tiles';

/**
 * MapLibre reads the routes and stops vector tiles through this protocol;
 * each request is forwarded to the feed worker (`EditorFeed.mapTile`).
 *
 * URLs carry a generation, bumped on every re-index, so a rebuilt layer
 * never shows a tile MapLibre cached from the previous index.
 */
const PROTOCOL = 'gtfszone-tiles';
const URL_PATTERN =
  /^gtfszone-tiles:\/\/(routes|stops|empty)\/\d+\/(\d+)\/(\d+)\/(\d+)$/;

/** Source layer names inside the tiles (see `MapTiles`). */
export const ROUTES_SOURCE_LAYER: MapTileLayer = 'routes';
export const STOPS_SOURCE_LAYER: MapTileLayer = 'stops';

let generation = 0;
let registered = false;

/** Tile URL template for `layer` at a fresh generation; null for no tiles. */
export function mapTileUrl(layer: MapTileLayer | null): string {
  generation++;
  return `${PROTOCOL}://${layer ?? 'empty'}/${generation}/{z}/{x}/{y}`;
}

/** Tile URL waiting for its source to go idle, by source id. */
const pendingUrls = new Map<string, string>();

/**
 * Point a vector source at `url` once none of its tiles is loading.
 *
 * MapLibre cannot switch URLs under a loading tile: the tile finishes from
 * the old URL and is then only re-parsed, never fetched from the new one, so
 * the switch waits for the source to settle. The newest URL wins.
 */
export function setSourceTiles(
  map: MapLibreMap,
  sourceId: string,
  url: string
): void {
  const waiting = pendingUrls.has(sourceId);
  pendingUrls.set(sourceId, url);
  if (waiting) {
    return;
  }
  const apply = (): boolean => {
    const source = map.getSource(sourceId) as VectorTileSource | undefined;
    if (!source) {
      pendingUrls.delete(sourceId);
      return true;
    }
    if (!map.isSourceLoaded(sourceId)) {
      return false;
    }
    source.setTiles([pendingUrls.get(sourceId)!]);
    pendingUrls.delete(sourceId);
    return true;
  };
  if (apply()) {
    return;
  }
  console.log(`[MapTiles] ${sourceId}: waiting for tiles in flight`);
  const onEvent = (e?: MapSourceDataEvent): void => {
    if (e && e.sourceId !== sourceId) {
      return;
    }
    if (apply()) {
      map.off('sourcedata', onEvent);
      map.off('idle', onIdle);
    }
  };
  const onIdle = (): void => onEvent();
  map.on('sourcedata', onEvent);
  map.on('idle', onIdle);
}

/** Register the protocol once; tiles are read from `feed` while it is open. */
export function registerMapTileProtocol(feed: EditorFeed): void {
  if (registered) {
    return;
  }
  registered = true;
  addProtocol(PROTOCOL, async (params) => {
    const match = URL_PATTERN.exec(params.url);
    if (!match) {
      throw new Error(`[MapTiles] bad tile URL ${params.url}`);
    }
    const layer = match[1];
    if (layer === 'empty' || !feed.isOpen) {
      return { data: new ArrayBuffer(0) };
    }
    const bytes = await feed.mapTile(
      layer as MapTileLayer,
      Number(match[2]),
      Number(match[3]),
      Number(match[4])
    );
    if (!bytes) {
      return { data: new ArrayBuffer(0) };
    }
    return {
      data: bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      ) as ArrayBuffer,
    };
  });
}
