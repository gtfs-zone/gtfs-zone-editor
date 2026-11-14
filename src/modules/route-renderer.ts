import { Map as MapLibreMap } from 'maplibre-gl';
import type { ExpressionSpecification, GeoJSONSource } from 'maplibre-gl';
import type { EditorFeed, FeedRow } from '../feed/editor-feed';
import { CONFIG } from '../config';
import { routeSortKey } from 'gtfs-zone-web-common/gtfs/route-sort';
import { ensureMapIcons } from 'gtfs-zone-web-common/map/icons';
import {
  routeColor as deriveRouteColor,
  casingColor as deriveCasingColor,
} from 'gtfs-zone-web-common/gtfs/route-colors';
import {
  NO_ROUTE_FILTER,
  ROUTES_BACKGROUND_LAYER,
  ROUTES_CASING_LAYER,
  ROUTES_CLICKAREA_LAYER,
  ROUTES_DIRECTION_LAYER,
  ROUTES_SOURCE,
  ROUTE_CASING_WIDTH_STOPS,
  ROUTE_WIDTH_STOPS,
  routeMatch,
  routeSortKeyExpression,
  routeSpotlightOpacity,
  zoomWidth,
} from 'gtfs-zone-web-common/map/layer-specs';
import {
  ROUTE_LABELS_LAYER,
  clearRouteLabelImages,
  installRouteLabelImages,
  routeLabelFilter,
  routeLabelLayerSpec,
  routeLabelText,
} from 'gtfs-zone-web-common/map/route-labels';

export interface RouteFeature extends GeoJSON.Feature {
  id: string;
  geometry: GeoJSON.LineString;
  properties: {
    route_id: string;
    route_data: FeedRow;
    color: string;
    colorDark: string;
    route_short_name?: string;
    route_long_name?: string;
    // line-sort-key: mode rank blended with the route's line count. Every
    // feature of a route carries the same value, so a route's segments never
    // reorder against each other. See route-sort.ts.
    sortKey: number;
  };
}

const ROUTE_LINE_WIDTH = zoomWidth(ROUTE_WIDTH_STOPS, null, 1);
const ROUTE_CASING_WIDTH = zoomWidth(ROUTE_CASING_WIDTH_STOPS, null, 1);

/**
 * Draws every route's distinct lines, built in the feed worker
 * (`routeGeometries`). Any change that can move a line rebuilds them all.
 */
export class RouteRenderer {
  private map: MapLibreMap;
  private feed: EditorFeed;
  private routeFeatures: RouteFeature[] = [];
  private routeLabels = new Map<
    string,
    { short?: string; long?: string; color: string }
  >();
  private initialized: boolean = false;
  private initializationPromise: Promise<void> | null = null;
  /** Bumped per build, so an older build that lands late is dropped. */
  private buildSeq = 0;

  constructor(map: MapLibreMap, feed: EditorFeed) {
    this.map = map;
    this.feed = feed;
    installRouteLabelImages(map, (routeId) => {
      const label = this.routeLabels.get(routeId);
      return label
        ? {
            text: routeLabelText({
              id: routeId,
              short_name: label.short,
              long_name: label.long,
            }),
            color: label.color,
          }
        : null;
    });

    this.initializationPromise = new Promise((resolve) => {
      if (this.map.isStyleLoaded() && this.map.loaded()) {
        this.initializeMapLayers().then(resolve);
      } else {
        this.map.once('load', async () => {
          await this.initializeMapLayers();
          resolve();
        });
      }
    });
  }

  public async ensureInitialized(): Promise<void> {
    if (this.initializationPromise && !this.initialized) {
      await this.initializationPromise;
    }

    if (this.initialized && !this.map.getSource(ROUTES_SOURCE)) {
      console.log('[RouteRenderer] Routes source missing, re-initializing...');
      this.initialized = false;
      this.initializationPromise = this.initializeMapLayers();
      await this.initializationPromise;
    }
  }

  private async initializeMapLayers(): Promise<void> {
    console.log('[RouteRenderer] Initializing MapLibre route layers...');

    if (this.initialized) {
      return;
    }

    if (this.map.getSource(ROUTES_SOURCE)) {
      this.initialized = true;
      return;
    }

    this.map.addSource(ROUTES_SOURCE, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [],
      },
    });

    this.map.addLayer({
      id: ROUTES_CASING_LAYER,
      type: 'line',
      source: ROUTES_SOURCE,
      paint: {
        'line-color': ['get', 'colorDark'],
        'line-width': ROUTE_CASING_WIDTH,
        'line-opacity': 1,
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
        'line-sort-key': ['get', 'sortKey'],
      },
    });

    this.map.addLayer({
      id: ROUTES_BACKGROUND_LAYER,
      type: 'line',
      source: ROUTES_SOURCE,
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ROUTE_LINE_WIDTH,
        'line-opacity': 1,
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
        'line-sort-key': ['get', 'sortKey'],
      },
    });

    // Direction chevrons for the single spotlighted route. Above the ribbon so
    // it can never cover them, below every stop layer (LayerManager adds those
    // later). Starts filtered to nothing; applySpotlight owns the filter.
    ensureMapIcons(this.map);
    this.map.addLayer({
      id: ROUTES_DIRECTION_LAYER,
      type: 'symbol',
      source: ROUTES_SOURCE,
      filter: NO_ROUTE_FILTER,
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': [
          'interpolate',
          ['linear'],
          ['zoom'],
          12,
          80,
          16,
          140,
        ],
        'icon-image': 'route-arrow',
        'icon-rotation-alignment': 'map',
        // An upright flip would reverse the arrow, the one thing this layer
        // must never do.
        'icon-keep-upright': false,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.5, 16, 1],
        // Let collision detection interleave the arrows where two
        // opposite-direction features share a corridor, rather than stacking
        // them on top of each other.
        'icon-allow-overlap': false,
        'icon-ignore-placement': false,
      },
      paint: {
        'icon-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          CONFIG.ROUTE_ARROW_FADE_ZOOM_MIN,
          0,
          CONFIG.ROUTE_ARROW_FADE_ZOOM_MAX,
          CONFIG.ROUTE_ARROW_OPACITY,
        ],
      },
    });

    this.map.addLayer({
      id: ROUTES_CLICKAREA_LAYER,
      type: 'line',
      source: ROUTES_SOURCE,
      paint: {
        'line-color': 'transparent',
        'line-width': 15,
        'line-opacity': 0,
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
        // Sorted identically to the drawn layers so queryRenderedFeatures()[0]
        // resolves to whichever route visually reads as on top.
        'line-sort-key': ['get', 'sortKey'],
      },
    });

    // Every route's name until some are spotlighted; applySpotlight owns the
    // filter.
    this.map.addLayer(routeLabelLayerSpec(ROUTES_SOURCE));
    this.map.setFilter(ROUTE_LABELS_LAYER, null);

    this.initialized = true;
    console.log('[RouteRenderer] Layers initialized');
  }

  /** Build every route's lines in the worker and draw them. */
  public async renderRoutes(): Promise<void> {
    await this.ensureInitialized();
    const seq = ++this.buildSeq;
    if (!this.feed.isOpen) {
      this.setFeatures([]);
      return;
    }
    const t0 = performance.now();
    const geometries = await this.feed.read('routeGeometries');
    if (seq !== this.buildSeq) {
      console.log('[RouteRenderer] build superseded');
      return;
    }
    const features: RouteFeature[] = [];
    const labels = new Map<
      string,
      { short?: string; long?: string; color: string }
    >();
    for (const geometry of geometries) {
      const route = this.feed.byKey('routes', geometry.routeId);
      if (!route) {
        continue;
      }
      const color = deriveRouteColor(route.route_id, route.route_color);
      const lineCount = geometry.lineStarts.length;
      const sortKey = routeSortKey(route.route_type, lineCount);
      labels.set(route.route_id, {
        short: route.route_short_name,
        long: route.route_long_name,
        color,
      });
      for (let i = 0; i < lineCount; i++) {
        const from = geometry.lineStarts[i];
        const to =
          i + 1 < lineCount
            ? geometry.lineStarts[i + 1]
            : geometry.coords.length / 2;
        const coordinates: [number, number][] = [];
        for (let p = from; p < to; p++) {
          coordinates.push([
            geometry.coords[p * 2],
            geometry.coords[p * 2 + 1],
          ]);
        }
        features.push({
          type: 'Feature',
          id: `${route.route_id}::${i}`,
          geometry: { type: 'LineString', coordinates },
          properties: {
            route_id: route.route_id,
            route_data: route,
            color,
            colorDark: deriveCasingColor(color),
            route_short_name: route.route_short_name,
            route_long_name: route.route_long_name,
            sortKey,
          },
        });
      }
    }
    if (this.map.style) {
      clearRouteLabelImages(this.map);
    }
    this.routeLabels = labels;
    this.setFeatures(features);
    console.log(
      `[RouteRenderer] ${features.length} lines for ${labels.size} routes in ${Math.round(performance.now() - t0)}ms`
    );
  }

  private setFeatures(features: RouteFeature[]): void {
    this.routeFeatures = features;
    const source = this.map.getSource(ROUTES_SOURCE) as
      GeoJSONSource | undefined;
    source?.setData({ type: 'FeatureCollection', features });
    this.map.triggerRepaint();
  }

  public clearRoutes(): void {
    this.buildSeq++;
    if (this.map.style) {
      clearRouteLabelImages(this.map);
    }
    this.routeLabels = new Map();
    this.setFeatures([]);
  }

  /**
   * Spotlight the given routes (or reset with null): non-matching routes dim
   * to CONFIG.SPOTLIGHT_ROUTE_DIM opacity, matching routes get a width bump.
   */
  private applySpotlight(route_ids: string[] | null): void {
    if (!this.map.getLayer(ROUTES_BACKGROUND_LAYER)) {
      return;
    }
    const match = routeMatch(route_ids);
    const opacity = routeSpotlightOpacity(match, CONFIG.SPOTLIGHT_ROUTE_DIM);
    this.map.setPaintProperty(ROUTES_BACKGROUND_LAYER, 'line-opacity', opacity);
    this.map.setPaintProperty(ROUTES_CASING_LAYER, 'line-opacity', opacity);
    this.map.setPaintProperty(
      ROUTES_BACKGROUND_LAYER,
      'line-width',
      zoomWidth(ROUTE_WIDTH_STOPS, match, CONFIG.SPOTLIGHT_LINE_BUMP)
    );
    this.map.setPaintProperty(
      ROUTES_CASING_LAYER,
      'line-width',
      zoomWidth(ROUTE_CASING_WIDTH_STOPS, match, CONFIG.SPOTLIGHT_CASING_BUMP)
    );

    // Lift the spotlighted routes above everything else. line-sort-key is a
    // layout property, so it cannot read feature-state, but the same literal
    // route_id match used for opacity works here unchanged. Layout changes
    // force a tile re-layout, which is fine once per selection but must never
    // be driven from hover.
    const sortKey = routeSortKeyExpression(match, CONFIG.SPOTLIGHT_SORT_KEY);
    for (const id of [
      ROUTES_CASING_LAYER,
      ROUTES_BACKGROUND_LAYER,
      ROUTES_CLICKAREA_LAYER,
    ]) {
      if (this.map.getLayer(id)) {
        this.map.setLayoutProperty(id, 'line-sort-key', sortKey);
      }
    }

    // Direction arrows only when exactly one route is spotlighted: a stop click
    // spotlights every route serving the stop, and arrows on all of them are
    // noise.
    if (this.map.getLayer(ROUTES_DIRECTION_LAYER)) {
      this.map.setFilter(
        ROUTES_DIRECTION_LAYER,
        route_ids && route_ids.length === 1
          ? ([
              '==',
              ['get', 'route_id'],
              route_ids[0],
            ] as unknown as ExpressionSpecification)
          : NO_ROUTE_FILTER
      );
    }
    if (this.map.getLayer(ROUTE_LABELS_LAYER)) {
      this.map.setFilter(
        ROUTE_LABELS_LAYER,
        route_ids?.length ? routeLabelFilter(route_ids) : null
      );
    }
  }

  public highlightRoute(route_id: string): void {
    if (this.routeFeatures.length === 0) {
      return;
    }
    console.log(`[RouteRenderer] Highlighting route: ${route_id}`);
    this.applySpotlight([route_id]);
  }

  public highlightRoutes(route_ids: string[]): void {
    if (this.routeFeatures.length === 0 || route_ids.length === 0) {
      return;
    }
    console.log(`[RouteRenderer] Highlighting ${route_ids.length} routes`);
    this.applySpotlight(route_ids);
  }

  public clearHighlight(): void {
    if (!this.initialized) {
      return;
    }
    this.applySpotlight(null);
  }

  /** The lines last drawn; empty until the first build lands. */
  public getRouteFeatures(): RouteFeature[] {
    return this.routeFeatures;
  }

  public destroy(): void {
    this.clearRoutes();

    if (this.map.getLayer(ROUTES_CLICKAREA_LAYER)) {
      this.map.removeLayer(ROUTES_CLICKAREA_LAYER);
    }
    if (this.map.getLayer(ROUTES_DIRECTION_LAYER)) {
      this.map.removeLayer(ROUTES_DIRECTION_LAYER);
    }
    if (this.map.getLayer(ROUTES_BACKGROUND_LAYER)) {
      this.map.removeLayer(ROUTES_BACKGROUND_LAYER);
    }
    if (this.map.getLayer(ROUTES_CASING_LAYER)) {
      this.map.removeLayer(ROUTES_CASING_LAYER);
    }
    if (this.map.getSource(ROUTES_SOURCE)) {
      this.map.removeSource(ROUTES_SOURCE);
    }
  }
}
