import {
  Map as MapLibreMap,
  LngLat,
  LngLatBounds,
  type FitBoundsOptions,
  type FlyToOptions,
  setWorkerUrl,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

import { registerMapTileProtocol } from './map-tile-protocol';
import { RouteRenderer } from './route-renderer';
import { DEFAULT_STOPS_FILTER, LayerManager } from './layer-manager';
import {
  InteractionHandler,
  InteractionCallbacks,
} from './interaction-handler';
import { PageStateManager } from './page-state-manager';
import type { EditorFeed, FeedEditEvent } from '../feed/editor-feed';
import type { RouteRefsIndex } from '../feed/route-refs';
import { updateOp } from '../feed/patch-build';
import { hasValidCoords } from '../utils/stop-coords';
import { CONFIG } from '../config';
import { agencyRouteFilter, normalizeAgencyId } from '../utils/agency-helpers';
import {
  BasemapControl,
  onBasemapChanged,
} from 'gtfs-zone-web-common/map/basemap-control';
import { AutoZoom } from 'gtfs-zone-web-common/map/auto-zoom';
import { MAP_MAX_ZOOM } from 'gtfs-zone-web-common/map/basemap-styles';
import { fitPadding } from 'gtfs-zone-web-common/map/fit-padding';
import { notify } from 'gtfs-zone-web-common/ui/notification-system';
import { getZoneFeature, listZones, zoneBounds } from './zone-store';
import {
  SearchPlaceMarker,
  type PlacePayload,
} from 'gtfs-zone-web-common/map/place-search';
import { t } from '../i18n/messages';

// Map interaction modes
export enum MapMode {
  NAVIGATE = 'navigate',
  ADD_STOP = 'add_stop',
  ADD_PATHWAY = 'add_pathway',
}

export type FocusedObject =
  | { type: 'stop'; id: string }
  | { type: 'pathway'; id: string }
  | { type: 'route'; id: string }
  | { type: 'zone'; id: string }
  | { type: 'none' };

// Callback interfaces
interface MapControllerCallbacks {
  onRouteSelect?: (route_id: string) => void;
  onStopSelect?: (stop_id: string) => void;
  onPathwaySelect?: (pathway_id: string) => void;
  onZoneSelect?: (location_id: string) => void;
  onModeChange?: (mode: MapMode) => void;
  onEmptyClick?: () => void;
  onStationExpandChange?: () => void;
}

/**
 * Professional MapController with modular architecture and Deck.gl integration
 *
 * Responsibilities:
 * - Map initialization and lifecycle management
 * - Coordination between RouteRenderer, LayerManager, and InteractionHandler
 * - Public API for map operations
 * - Integration with page state management
 */
type FeedRowList = readonly Readonly<Record<string, string>>[];

export class MapController {
  private map: MapLibreMap | null = null;
  private mapElementId: string;

  // Core modules
  private routeRenderer: RouteRenderer | null = null;
  private layerManager: LayerManager | null = null;
  private interactionHandler: InteractionHandler | null = null;
  private basemapControl: BasemapControl | null = null;

  // Dependencies (injected)
  private feed: EditorFeed | null = null;
  private routeRefs: RouteRefsIndex | null = null;
  /** Transfers of the focused stop, fetched from the worker. */
  private focusedTransfers: { stop_id: string; rows: FeedRowList } = {
    stop_id: '',
    rows: [],
  };
  private transferSeq = 0;
  private pageStateManager: PageStateManager | null = null;

  // Callbacks
  private callbacks: MapControllerCallbacks = {};

  // State
  private isInitialized = false;
  private resizeTimeout: NodeJS.Timeout | null = null;
  private basemapChangeHandlerSet = false;
  private focusedObject: FocusedObject = { type: 'none' };
  // Rings the place picked from search until cleared; made on first pick.
  private placeMarker: SearchPlaceMarker | null = null;
  // Sole owner of the route spotlight (line dimming + revealed stops). Null when cleared.
  private spotlightRouteIds: string[] | null = null;
  // Identity of the stops filter currently on the map, so applyStopsFilter can
  // skip a repaint when nothing about it changed. '' is the default filter.
  private appliedStopsFilterKey = '';
  // The map update in flight and the feed generation it is drawing, so a second
  // call for the same feed joins it instead of racing it.
  private mapUpdateInFlight: { gen: number; promise: Promise<void> } | null =
    null;

  private bottomPadding = 0;

  // Navigation-driven camera moves are suppressed while this is off. Feed
  // loads, resize restores and the add-stop zoom nudge bypass it.
  private autoZoom = new AutoZoom(() => {
    if (this.isMapReady()) {
      this.refitFocusedObject();
    }
  });

  constructor(mapElementId = 'map') {
    this.mapElementId = mapElementId;
  }

  public setBottomPadding(px: number): void {
    this.bottomPadding = px;
  }

  public getAutoZoom(): AutoZoom {
    return this.autoZoom;
  }

  public isAutoZoomEnabled(): boolean {
    return this.autoZoom.isEnabled();
  }

  /** Re-run the camera move for the currently focused object. */
  private refitFocusedObject(): void {
    const station = this.getExpandedStationId();
    if (station) {
      this.flyToStation(station);
      return;
    }
    switch (this.focusedObject.type) {
      case 'route':
        this.flyToRoute(this.focusedObject.id);
        break;
      case 'stop':
      case 'pathway':
        this.flyToStop(this.focusedObject.id);
        break;
      case 'zone':
        this.fitToZone(this.focusedObject.id);
        break;
      default:
        this.fitMapToData();
        break;
    }
  }

  /** Camera moves driven by navigation, gated on the auto-zoom preference. */
  private autoFit(bounds: LngLatBounds, options: FitBoundsOptions): void {
    this.fitCamera(bounds, options, false);
  }

  /**
   * Fit the map to bounds, forced or through the auto-zoom gate. MapLibre
   * throws "Invalid LngLat object: (NaN, NaN)" when the space left after
   * padding is exactly 0, so the camera is computed first and a fit with no
   * finite camera is skipped with a warning.
   */
  private fitCamera(
    bounds: LngLatBounds,
    options: FitBoundsOptions,
    force: boolean
  ): void {
    const map = this.map!;
    let camera: ReturnType<MapLibreMap['cameraForBounds']>;
    let error: unknown = null;
    try {
      camera = map.cameraForBounds(bounds, options);
    } catch (e) {
      error = e;
    }
    const center = camera ? LngLat.convert(camera.center!) : null;
    if (
      !camera ||
      !center ||
      !Number.isFinite(center.lng) ||
      !Number.isFinite(center.lat) ||
      !Number.isFinite(camera.zoom)
    ) {
      const container = map.getContainer();
      console.warn('[MapController] skipping fit: no finite camera', {
        bounds: bounds.toArray(),
        padding: options.padding,
        container: [container.clientWidth, container.clientHeight],
        camera,
        error,
      });
      return;
    }
    if (force) {
      map.fitBounds(bounds, options);
    } else {
      this.autoZoom.fitBounds(map, bounds, options);
    }
  }

  private autoFlyTo(options: FlyToOptions): void {
    this.autoZoom.flyTo(this.map!, options);
  }

  /**
   * Initialize the map controller with dependencies
   */
  public async initialize(
    feed: EditorFeed,
    routeRefs: RouteRefsIndex
  ): Promise<void> {
    if (this.isInitialized) {
      console.warn('MapController already initialized');
      return;
    }

    this.feed = feed;
    this.routeRefs = routeRefs;
    this.initializeMap();
    this.map!.on('click', () => this.placeMarker?.clear());
    await this.initializeModules();
    this.setupModuleCallbacks();
    this.subscribeToEdits(feed);
    // A route index build landing later re-lights the current spotlight.
    routeRefs.onChange(() => {
      if (this.spotlightRouteIds) {
        this.applySpotlight(this.spotlightRouteIds);
      }
    });
    this.isInitialized = true;

    console.log('MapController initialized successfully');
  }

  /**
   * Follow edits: a change redraws what its tables can move, a history move
   * rebuilds the whole map.
   */
  private subscribeToEdits(feed: EditorFeed): void {
    feed.onEdit((e) => {
      if (e.kind !== 'change') {
        this.updateMap().catch((err: unknown) =>
          console.error('[MapController] hard reset failed:', err)
        );
        return;
      }
      this.handleChange(e);
    });
  }

  /** Redraw the layers an edit's tables and files feed. */
  private handleChange(e: FeedEditEvent): void {
    if (!this.routeRenderer || !this.layerManager) {
      return;
    }
    const touched = new Set(e.tables);
    console.log(
      `[MapController] edit touched ${[...e.tables, ...e.files].join(', ')}`
    );
    if (touched.has('stops')) {
      this.layerManager.invalidateCoordResolver();
      this.layerManager.updateStopsData();
      const station = this.deriveExpandedStation();
      if (station) {
        this.layerManager.rebuildPathwaysSource(station);
      }
    }
    if (touched.has('pathways')) {
      const station = this.deriveExpandedStation();
      if (station) {
        this.layerManager.invalidateCoordResolver();
        this.layerManager.rebuildPathwaysSource(station);
      }
    }
    if (
      ['routes', 'trips', 'shapes', 'stop_times', 'stops'].some((t) =>
        touched.has(t)
      )
    ) {
      this.routeRenderer
        .renderRoutes()
        .then(() => {
          if (this.spotlightRouteIds) {
            this.routeRenderer?.highlightRoutes(this.spotlightRouteIds);
          }
        })
        .catch((err: unknown) =>
          console.error('[MapController] route redraw failed:', err)
        );
    }
    if (touched.has('transfers') && this.focusedObject.type === 'stop') {
      this.highlightStop(this.focusedObject.id);
    }
    if (e.files.includes('locations.geojson')) {
      this.layerManager.updateZonesLayer();
    }
  }

  /**
   * Initialize MapLibre GL map
   */
  private initializeMap(): void {
    // maplibre resolves its worker relative to its own module URL, which
    // breaks once Vite bundles or pre-bundles it; point it at a Vite-built copy.
    setWorkerUrl(maplibreWorkerUrl);
    this.map = new MapLibreMap({
      container: this.mapElementId,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            maxzoom: 19,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [
          {
            id: 'osm',
            type: 'raster',
            source: 'osm',
          },
        ],
      },
      center: [-74.006, 40.7128], // NYC default
      zoom: 10,
      maxZoom: MAP_MAX_ZOOM,
    });
  }

  /**
   * Initialize core modules
   */
  private async initializeModules(): Promise<void> {
    if (!this.map || !this.feed) {
      throw new Error('Map or feed not available for module initialization');
    }

    // Initialize modules
    registerMapTileProtocol(this.feed);
    this.layerManager = new LayerManager(this.map, this.feed);
    this.routeRenderer = new RouteRenderer(this.map, this.feed);
    this.interactionHandler = new InteractionHandler(this.map, this.feed);
    this.basemapControl = new BasemapControl(this.map);

    // Let InteractionHandler read the expanded station id for contextual stop creation
    this.interactionHandler.setGetExpandedStationId(() =>
      this.getExpandedStationId()
    );

    // Setup basemap change handler to re-add layers
    this.setupBasemapChangeHandler();

    // Start RouteRenderer initialization in the background, don't block UI setup.
    // ensureInitialized() is called lazily from renderRoutes/updateMap when needed.
  }

  /**
   * Setup callbacks between modules
   */
  private setupModuleCallbacks(): void {
    if (!this.interactionHandler || !this.routeRenderer) {
      return;
    }

    // Setup interaction callbacks
    const interactionCallbacks: InteractionCallbacks = {
      onRouteClick: this.handleRouteClick.bind(this),
      onStopClick: this.handleStopClick.bind(this),
      onPathwayClick: this.handlePathwayClick.bind(this),
      onZoneClick: this.handleZoneClick.bind(this),
      onPathwayCreated: this.handlePathwayCreated.bind(this),
      onModeChange: this.handleModeChange.bind(this),
      onStopDragComplete: this.handleStopDragComplete.bind(this),
      onStopCreated: this.handleStopCreated.bind(this),
      onEmptyClick: () => {
        void this.handleEmptyClick();
      },
    };

    this.interactionHandler.setCallbacks(interactionCallbacks);
  }

  /**
   * Setup basemap change handler to re-add GTFS layers
   */
  private setupBasemapChangeHandler(): void {
    if (!this.map || this.basemapChangeHandlerSet) {
      return;
    }

    this.basemapChangeHandlerSet = true;

    onBasemapChanged(this.map, async () => {
      console.log('Re-adding GTFS layers after basemap change...');
      this.placeMarker?.redraw();

      // Check if we have GTFS data loaded
      if (!this.feed?.isOpen) {
        console.log('[MapController] no feed open, skipping layer re-add');
        return;
      }

      // Re-render routes and stops after basemap change
      if (this.routeRenderer && this.layerManager) {
        try {
          // Wait for style to load
          await this.routeRenderer.ensureInitialized();

          // Clear existing layers first
          this.layerManager.clearAllLayers();
          this.routeRenderer.clearRoutes();

          // Re-render routes
          await this.routeRenderer.renderRoutes();

          // Re-add stops layer (styling comes from LayerManager defaults)
          this.layerManager.addStopsLayer({
            showBackground: true,
            showClickArea: true,
            enableHover: true,
          });

          this.layerManager.updateZonesLayer();

          // Restore highlights and expanded station/pathways if any.
          // Reset focusedObject first so applyFocusedObject sees oldStation -> newStation
          // as a real change and re-expands the station (recreating the pathway layer).
          const obj = this.focusedObject;
          this.focusedObject = { type: 'none' };
          const counterparts =
            obj.type === 'stop' ? this.transferCounterparts(obj.id) : [];
          const transfers = obj.type === 'stop' ? this.transfersOf(obj.id) : [];
          this.appliedStopsFilterKey = '';
          this.applyFocusedObject(obj, counterparts);
          // Re-apply whatever spotlight was active before the basemap swap,
          // regardless of which focus type produced it.
          this.applySpotlight(this.spotlightRouteIds);
          if (obj.type === 'stop') {
            // The new source dropped every feature state and the transfer
            // layers went with the old style, so the additive half of the stop
            // selection has to be drawn again.
            this.layerManager.showTransferEdges(obj.id, transfers);
            const station = this.getExpandedStationId();
            this.layerManager.setKeptStops([
              ...(station ? this.stationMembers(station) : []),
              ...counterparts,
            ]);
          }
          // Back on top of the feed layers just re-added.
          this.placeMarker?.redraw();
          console.log('GTFS layers re-added after basemap change');
        } catch (error) {
          console.error('Failed to re-add GTFS layers:', error);
        }
      }
    });
  }

  /**
   * Set page state manager for URL integration
   */
  public setPageStateManager(pageStateManager: PageStateManager): void {
    this.pageStateManager = pageStateManager;
  }

  /**
   * Set callbacks for external integration
   */
  public setCallbacks(callbacks: Partial<MapControllerCallbacks>): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * Update map with current GTFS data.
   *
   * Scoped to the feed it was started for: the route build yields to the event
   * loop, so a whole import can land inside these awaits. An update whose feed
   * has been replaced returns without touching the layers or the camera, and a
   * second call for the same feed joins the one already running instead of
   * starting a competing render.
   */
  public async updateMap(): Promise<void> {
    const gen = this.feed?.feedGeneration ?? 0;
    if (this.mapUpdateInFlight?.gen === gen) {
      return this.mapUpdateInFlight.promise;
    }
    const tracked = this.runMapUpdate(gen).finally(() => {
      if (this.mapUpdateInFlight?.promise === tracked) {
        this.mapUpdateInFlight = null;
      }
    });
    this.mapUpdateInFlight = { gen, promise: tracked };
    return tracked;
  }

  /**
   * True once the feed this update was started for is no longer the loaded one.
   */
  private feedSuperseded(gen: number, stage: string): boolean {
    const current = this.feed?.feedGeneration ?? 0;
    if (current === gen) {
      return false;
    }
    console.log(
      `[MapController] map update for feed generation ${gen} superseded by ${current} (after ${stage})`
    );
    return true;
  }

  /**
   * Drop everything the previous feed drew.
   *
   * Subscribed to the feed-replaced signal, so the map empties the moment a
   * feed stops being the loaded one rather than at the start of the next
   * render, which on a large feed is seconds later.
   */
  public clearForNewFeed(): void {
    if (!this.map) {
      return;
    }
    this.focusedObject = { type: 'none' };
    this.focusedTransfers = { stop_id: '', rows: [] };
    this.transferSeq++;
    this.spotlightRouteIds = null;
    this.appliedStopsFilterKey = '';
    this.placeMarker?.clear();
    this.layerManager?.setStopsFilter(null);
    this.layerManager?.clearAllLayers();
    this.routeRenderer?.clearRoutes();
  }

  private async runMapUpdate(gen: number): Promise<void> {
    if (!this.isMapReady()) {
      return;
    }

    // Reset focus state when feed changes
    this.focusedObject = { type: 'none' };
    this.spotlightRouteIds = null;
    this.appliedStopsFilterKey = '';
    this.layerManager?.setStopsFilter(null);

    // Ensure RouteRenderer is initialized (this waits for map style to load)
    await this.routeRenderer!.ensureInitialized();
    if (this.feedSuperseded(gen, 'ensureInitialized')) {
      return;
    }

    // Reset any spotlight dimming left over from a selection in the old feed
    this.routeRenderer!.clearHighlight();

    // Clear existing layers
    this.layerManager!.clearAllLayers();
    this.routeRenderer!.clearRoutes();

    // Wait for route rendering to complete
    await this.routeRenderer!.renderRoutes();
    if (this.feedSuperseded(gen, 'renderRoutes')) {
      return;
    }
    // A page render during the build spotlit routes that had no features yet
    if (this.spotlightRouteIds) {
      this.routeRenderer!.highlightRoutes(this.spotlightRouteIds);
    }

    // Invalidate cached coord resolver so it rebuilds with the current feed's stops
    this.layerManager!.invalidateCoordResolver();

    // Add stops using LayerManager (styling comes from LayerManager defaults)
    this.layerManager!.addStopsLayer({
      showBackground: true,
      showClickArea: true,
      enableHover: true,
    });

    // After the route and stop layers exist: zones insert themselves below both.
    this.layerManager!.updateZonesLayer();

    // Fit map to show all data. Forced: a newly loaded feed must be framed
    // even when auto-zoom is off, or it opens on the previous feed's area.
    this.fitMapToData(true);

    console.log('Map update completed');
  }

  /**
   * Check if map is ready for operations
   */
  private isMapReady(): boolean {
    return !!this.feed?.isOpen && !!this.map;
  }

  public focusFeed(): void {
    this.clearHighlights();
    this.fitMapToData();
  }

  /**
   * The one geometry collector every fit goes through. Extends over stop
   * coordinates, zone bounding boxes, the member stops of a location group and
   * (when include_shapes) the route lines themselves. With include_shapes,
   * route_ids narrows the shapes to those routes; omitting route_ids takes
   * every shape in the feed. Returns null when nothing contributed a
   * coordinate, so callers can leave the viewport alone.
   *
   * A flex feed can legally have an empty stops.txt, so nothing here may assume
   * stops are the only source of geometry.
   */
  private boundsFor(input: {
    stop_ids?: Iterable<string>;
    zone_ids?: Iterable<string>;
    location_group_ids?: Iterable<string>;
    route_ids?: Iterable<string>;
    include_shapes?: boolean;
  }): LngLatBounds | null {
    const feed = this.feed;
    if (!feed?.isOpen) {
      return null;
    }

    // Running min/max over stop coordinates, zone bounds and route bounds.
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    const extend = (lng: number, lat: number) => {
      if (lng < west) {
        west = lng;
      }
      if (lng > east) {
        east = lng;
      }
      if (lat < south) {
        south = lat;
      }
      if (lat > north) {
        north = lat;
      }
    };

    const stop_ids = new Set(input.stop_ids ?? []);
    for (const location_group_id of input.location_group_ids ?? []) {
      for (const stop_id of this.stopIdsForLocationGroup(location_group_id)) {
        stop_ids.add(stop_id);
      }
    }
    if (stop_ids.size > 0) {
      for (const stop of feed.table('stops')) {
        if (stop_ids.has(stop.stop_id) && hasValidCoords(stop)) {
          extend(Number(stop.stop_lon), Number(stop.stop_lat));
        }
      }
    }

    for (const location_id of input.zone_ids ?? []) {
      const feature = getZoneFeature(feed, location_id);
      const bbox = feature ? zoneBounds(feature) : null;
      if (!bbox) {
        continue;
      }
      // zoneBounds is [west, south, east, north]: both corners, not the raw array
      extend(bbox[0], bbox[1]);
      extend(bbox[2], bbox[3]);
    }

    if (input.include_shapes) {
      // route_ids present means "the shapes of these routes"; absent means
      // every shape in the feed, which is what a feed-wide fit wants.
      const wanted = input.route_ids ? new Set(input.route_ids) : null;
      for (const [route_id, bbox] of this.routeRenderer?.getRouteBounds() ??
        []) {
        if (wanted && !wanted.has(route_id)) {
          continue;
        }
        extend(bbox[0], bbox[1]);
        extend(bbox[2], bbox[3]);
      }
    }

    if (west === Infinity) {
      return null;
    }
    return new LngLatBounds([west, south], [east, north]);
  }

  /**
   * Every reference a route's trips make, split by kind. Empty until the
   * route index has been built for the feed.
   */
  private refsForRoute(route_id: string): {
    stop_ids: string[];
    zone_ids: string[];
    location_group_ids: string[];
  } {
    const refs = this.routeRefs?.route(route_id);
    return {
      stop_ids: refs?.stops ?? [],
      zone_ids: refs?.zones ?? [],
      location_group_ids: refs?.groups ?? [],
    };
  }

  /**
   * Fit map to show all GTFS data: every stop, every on-demand zone and every
   * route line. The shapes matter because a feed's lines routinely run outside
   * the hull of its stops, and a flex feed can have no stops at all.
   */
  private fitMapToData(force = false): void {
    const stops = this.feed!.table('stops');
    const zones = listZones(this.feed!);

    const bounds = this.boundsFor({
      stop_ids: stops.map((stop) => stop.stop_id),
      zone_ids: zones.map((feature) => String(feature.id)),
      include_shapes: true,
    });
    if (!bounds) {
      return;
    }

    const options: FitBoundsOptions = {
      padding: fitPadding(this.map!, 50, this.bottomPadding),
    };
    this.fitCamera(bounds, options, force);
  }

  // ========================================
  // FOCUS STATE MANAGEMENT
  // ========================================

  /**
   * Derive the currently expanded station from the focused object.
   * Returns the station stop_id, or null if no station should be expanded.
   */
  private deriveExpandedStation(): string | null {
    const obj = this.focusedObject;
    const feed = this.feed;
    if (!feed?.isOpen) {
      return null;
    }

    if (obj.type === 'stop') {
      const stop = feed.byKey('stops', obj.id);
      if (!stop) {
        return null;
      }
      const locationType = parseInt(stop.location_type ?? '0', 10) || 0;
      if (locationType === 1) {
        return stop.stop_id;
      }
      return stop.parent_station || null;
    }

    if (obj.type === 'pathway') {
      const pathway = feed.byKey('pathways', obj.id);
      const fromStop = pathway
        ? feed.byKey('stops', pathway.from_stop_id ?? '')
        : null;
      if (!fromStop) {
        return null;
      }
      if (fromStop.parent_station) {
        return fromStop.parent_station;
      }
      const lt = parseInt(fromStop.location_type ?? '0', 10) || 0;
      return lt === 1 ? fromStop.stop_id : null;
    }

    return null;
  }

  /**
   * Fly to the bounding box of a station and its children.
   */
  private flyToStation(stationId: string): void {
    const stops = this.feed!.table('stops');
    const coords: [number, number][] = stops
      .filter(
        (s) =>
          (s.stop_id === stationId || s.parent_station === stationId) &&
          hasValidCoords(s)
      )
      .map((s) => [Number(s.stop_lon), Number(s.stop_lat)]);

    if (coords.length === 0) {
      return;
    }

    if (coords.length === 1) {
      this.autoFlyTo({
        center: coords[0],
        zoom: CONFIG.STOP_FOCUS_ZOOM,
        duration: 1000,
        essential: true,
        padding: fitPadding(this.map!, 80, this.bottomPadding),
      });
    } else {
      const bounds = coords
        .slice(1)
        .reduce(
          (b, coord) => b.extend(coord),
          new LngLatBounds(coords[0], coords[0])
        );
      this.autoFit(bounds, {
        padding: fitPadding(this.map!, 80, this.bottomPadding),
        maxZoom: CONFIG.STOP_FOCUS_ZOOM,
        duration: 1000,
        essential: true,
      });
    }
  }

  /**
   * Narrow the stops layers to the expanded station, and always admit the stops
   * that have to stay drawn on top of whatever else is showing (the focused
   * stop's transfer counterparts, which are child platforms often enough that
   * the default filter would drop them and leave their edge pointing at
   * nothing). Skipped when the filter is already the one on the map, since
   * setStopsFilter repaints five layers.
   */
  private applyStopsFilter(
    station_id: string | null,
    keepVisible: string[]
  ): void {
    const key = `${station_id ?? ''}|${[...keepVisible].sort().join(',')}`;
    if (key === this.appliedStopsFilterKey) {
      return;
    }
    this.appliedStopsFilterKey = key;

    if (station_id === null && keepVisible.length === 0) {
      this.layerManager?.setStopsFilter(null);
      return;
    }
    const base: unknown =
      station_id === null
        ? DEFAULT_STOPS_FILTER
        : [
            'any',
            ['==', ['get', 'stop_id'], station_id],
            ['==', ['get', 'station_id'], station_id],
          ];
    this.layerManager?.setStopsFilter([
      'any',
      base,
      ['in', ['get', 'stop_id'], ['literal', keepVisible]],
    ] as unknown as import('maplibre-gl').FilterSpecification);
  }

  /**
   * Set the focused object and apply any station expand/collapse side effects.
   */
  private applyFocusedObject(
    obj: FocusedObject,
    keepVisible: string[] = []
  ): void {
    const oldStation = this.deriveExpandedStation();
    this.focusedObject = obj;
    const newStation = this.deriveExpandedStation();
    this.layerManager?.setFocusedStop(obj.type === 'stop' ? obj.id : null);
    this.layerManager?.setFocusedZone(obj.type === 'zone' ? obj.id : null);

    // The filter depends on the focused stop, not only on the station: moving
    // between two platforms of one station changes which transfer counterparts
    // have to be admitted, so it is recomputed on every call.
    this.applyStopsFilter(newStation, keepVisible);

    if (oldStation !== newStation) {
      if (newStation) {
        this.layerManager?.updatePathwaysLayer(newStation);
        this.layerManager?.setFocusedPathway(
          obj.type === 'pathway' ? obj.id : null
        );
        this.flyToStation(newStation);
      } else {
        this.layerManager?.clearPathwaysLayer();
      }
      this.callbacks.onStationExpandChange?.();
    } else if (newStation) {
      // Station unchanged but focused object may have changed, update pathway highlight
      this.layerManager?.setFocusedPathway(
        obj.type === 'pathway' ? obj.id : null
      );
    }
  }

  /**
   * Repaint the accent-colored map styling after a theme switch.
   */
  public refreshAccentColor(): void {
    this.layerManager?.refreshAccentColor();
    this.placeMarker?.redraw();
  }

  /**
   * Get the currently expanded station id (derived from focusedObject).
   */
  public getExpandedStationId(): string | null {
    return this.deriveExpandedStation();
  }

  // ========================================
  // HIGHLIGHTING AND NAVIGATION METHODS
  // ========================================

  /**
   * The given stops plus every parent_station above them.
   *
   * `getStopIdsForRoute` returns what stop_times references, which in a feed
   * that models platforms is the children. Those features are not drawn while
   * their station is collapsed (DEFAULT_STOPS_FILTER keeps only top-level stops
   * and stations), so marking only them leaves the spotlight invisible: the
   * station that is drawn never gets the onRoute state, so it is not a
   * SPECIAL_STOP and gets faded out with everything else.
   *
   * Both ends are kept rather than replacing the child with its station, so an
   * expanded station's platforms stay lit too.
   */
  private withAncestors(stop_ids: Set<string>): Set<string> {
    const stops = this.feed?.isOpen ? this.feed.table('stops') : [];
    if (stops.length === 0) {
      return stop_ids;
    }
    const parentOf = new Map<string, string>();
    for (const stop of stops) {
      const parent = stop.parent_station ? String(stop.parent_station) : '';
      if (parent) {
        parentOf.set(String(stop.stop_id), parent);
      }
    }

    const result = new Set(stop_ids);
    for (const stop_id of stop_ids) {
      const seen = new Set<string>([stop_id]);
      let current = stop_id;
      for (;;) {
        const parent = parentOf.get(current);
        if (!parent || seen.has(parent)) {
          break;
        }
        seen.add(parent);
        result.add(parent);
        current = parent;
      }
    }
    return result;
  }

  /**
   * The focused stop's transfers, fetched by `highlightStop`. Empty for any
   * other stop, or until the fetch lands.
   */
  private transfersOf(stop_id: string): FeedRowList {
    return this.focusedTransfers.stop_id === stop_id
      ? this.focusedTransfers.rows
      : [];
  }

  /**
   * The other endpoint of every transfer naming this stop.
   *
   * Types 4 and 5 link two trips rather than two places and are not drawn, so
   * they are skipped here too, matching `LayerManager.showTransferEdges`.
   */
  private transferCounterparts(stop_id: string): string[] {
    const counterparts = new Set<string>();
    for (const transfer of this.transfersOf(stop_id)) {
      const from = transfer.from_stop_id ?? '';
      const to = transfer.to_stop_id ?? '';
      const type = Number(transfer.transfer_type ?? 0) || 0;
      if (type === 4 || type === 5) {
        continue;
      }
      const other = from === stop_id ? to : from;
      if (other !== '' && other !== stop_id) {
        counterparts.add(other);
      }
    }
    return [...counterparts];
  }

  /**
   * A station plus every stop below it. The mirror of `withAncestors`: the
   * station filter draws the whole subtree, so the whole subtree has to survive
   * the route spotlight's dim, not only the platforms a route happens to serve.
   */
  private stationMembers(station_id: string): string[] {
    const stops = this.feed?.isOpen ? this.feed.table('stops') : [];
    const childrenOf = new Map<string, string[]>();
    for (const stop of stops) {
      const parent = stop.parent_station ? String(stop.parent_station) : '';
      if (!parent) {
        continue;
      }
      const siblings = childrenOf.get(parent);
      if (siblings) {
        siblings.push(String(stop.stop_id));
      } else {
        childrenOf.set(parent, [String(stop.stop_id)]);
      }
    }

    const members = new Set<string>([station_id]);
    const frontier = [station_id];
    while (frontier.length > 0) {
      const current = frontier.pop()!;
      for (const child of childrenOf.get(current) || []) {
        if (members.has(child)) {
          continue;
        }
        members.add(child);
        frontier.push(child);
      }
    }
    return [...members];
  }

  /**
   * Sole owner of the route spotlight: dims non-matching route lines and
   * reveals the given routes' stops (visible/clickable at any zoom) and zones.
   * Pass null to clear. Callers must not call routeRenderer.highlightRoute(s),
   * layerManager.setRouteStops or layerManager.setRouteZones directly, go
   * through this method so the halves never get applied separately.
   */
  private applySpotlight(route_ids: string[] | null): void {
    this.spotlightRouteIds =
      route_ids && route_ids.length > 0 ? route_ids : null;

    if (this.spotlightRouteIds) {
      this.routeRenderer?.highlightRoutes(this.spotlightRouteIds);
      const stop_ids = new Set<string>();
      const zone_ids = new Set<string>();
      for (const route_id of this.spotlightRouteIds) {
        const refs = this.refsForRoute(route_id);
        for (const stop_id of refs.stop_ids) {
          stop_ids.add(stop_id);
        }
        for (const location_group_id of refs.location_group_ids) {
          for (const stop_id of this.stopIdsForLocationGroup(
            location_group_id
          )) {
            stop_ids.add(stop_id);
          }
        }
        for (const location_id of refs.zone_ids) {
          zone_ids.add(location_id);
        }
      }
      this.layerManager?.setRouteStops([...this.withAncestors(stop_ids)]);
      this.layerManager?.setRouteZones([...zone_ids]);
    } else {
      this.routeRenderer?.clearHighlight();
      this.layerManager?.setRouteStops([]);
      this.layerManager?.setRouteZones([]);
    }
  }

  /**
   * Highlight specific route: spotlight the route line and reveal all of its
   * stops (visible and clickable at any zoom while selected).
   */
  public highlightRoute(route_id: string): void {
    this.interactionHandler?.setHighlightedStop(null);
    this.layerManager?.clearHighlights();

    this.applyFocusedObject({ type: 'route', id: route_id });

    this.applySpotlight([route_id]);

    // Smoothly fly to route bounds
    this.flyToRoute(route_id);

    console.log(`Highlighted route: ${route_id}`);
  }

  /**
   * Light up a stop the user is hovering elsewhere in the app (the timetable
   * stop column). Purely visual: no fly-to, no spotlight, no focus change.
   */
  public hoverStop(stop_id: string | null): void {
    this.layerManager?.setHoveredStop(stop_id);
  }

  /**
   * Light one transfer edge of the focused stop, e.g. from a hovered row in the
   * stop page's transfers list. Purely visual, same as hoverStop.
   */
  public hoverTransfer(
    edge: { from_stop_id: string; to_stop_id: string } | null
  ): void {
    this.layerManager?.setHoveredTransfer(edge);
  }

  /** The zone counterpart of hoverStop. Purely visual, same as hoverStop. */
  public hoverZone(location_id: string | null): void {
    this.layerManager?.setHoveredZone(location_id);
  }

  /**
   * A location group has no geometry of its own, so hovering one lights every
   * member stop at once.
   */
  public hoverLocationGroup(location_group_id: string | null): void {
    if (location_group_id === null) {
      this.layerManager?.setHoveredStops([]);
      return;
    }
    this.layerManager?.setHoveredStops(
      this.stopIdsForLocationGroup(location_group_id)
    );
  }

  /**
   * Highlight specific stop
   */
  public highlightStop(stop_id: string): void {
    this.drawStop(stop_id);
    if (this.focusedTransfers.stop_id === stop_id || !this.feed?.isOpen) {
      return;
    }
    // Transfers live in the worker: draw without them, then again once
    // they land if the stop is still the focused one.
    const seq = ++this.transferSeq;
    const feed = this.feed;
    Promise.all([
      feed.where('transfers', [{ col: 'from_stop_id', eq: stop_id }]),
      feed.where('transfers', [{ col: 'to_stop_id', eq: stop_id }]),
    ])
      .then(([from, to]) => {
        if (seq !== this.transferSeq) {
          return;
        }
        this.focusedTransfers = {
          stop_id,
          rows: [...from, ...to.filter((r) => r.from_stop_id !== stop_id)],
        };
        const focused = this.focusedObject;
        if (focused.type === 'stop' && focused.id === stop_id) {
          this.drawStop(stop_id, false);
        }
      })
      .catch((e: unknown) =>
        console.error(`[MapController] transfers of ${stop_id} failed:`, e)
      );
  }

  private drawStop(stop_id: string, fly = true): void {
    this.interactionHandler?.setHighlightedStop(null);
    this.layerManager?.clearHighlights();

    // Computed before the filter is applied so the stops admitted by it and the
    // edges drawn below are the same set.
    const counterparts = this.transferCounterparts(stop_id);
    this.applyFocusedObject({ type: 'stop', id: stop_id }, counterparts);

    this.interactionHandler?.setHighlightedStop(stop_id);

    // Transfers of this stop only. Cleared by layerManager.clearHighlights(),
    // which every other highlight* call runs first.
    this.layerManager?.showTransferEdges(stop_id, this.transfersOf(stop_id));

    // Get routes that serve this stop and spotlight them (line + their stops)
    const route_ids = this.routeRefs?.routesAtStop(stop_id) ?? [];
    this.applySpotlight(route_ids.length > 0 ? route_ids : null);

    // Selecting a stop only adds emphasis: the station's other platforms and
    // the transfer endpoints stay lit whatever the spotlight dims. After
    // applySpotlight, which repaints the same layers.
    const station = this.getExpandedStationId();
    this.layerManager?.setKeptStops([
      ...(station ? this.stationMembers(station) : []),
      ...counterparts,
    ]);

    // For child stops and stations, applyFocusedObject already flew to the
    // expanded station via flyToStation, skip the individual-stop flyTo so
    // it doesn't override the station fit. Only fly to the stop directly when
    // no station is expanded (i.e. standalone stops).
    if (fly && this.getExpandedStationId() === null) {
      this.flyToStop(stop_id);
    }
    console.log(`Highlighted stop: ${stop_id}`);
  }

  /**
   * Highlight specific pathway. Mirrors highlightStop/highlightRoute, used
   * when navigation to a pathway originates from the side panel or a URL hash
   * rather than an on-map click.
   */
  public highlightPathway(pathway_id: string): void {
    this.interactionHandler?.setHighlightedStop(null);
    this.layerManager?.clearHighlights();
    this.applySpotlight(null);

    this.applyFocusedObject({ type: 'pathway', id: pathway_id });

    console.log(`Highlighted pathway: ${pathway_id}`);
  }

  /**
   * Highlight an on-demand zone and fit the map to its polygon. Mirrors
   * highlightPathway: used when navigation originates off-map.
   */
  public highlightZone(location_id: string): void {
    this.interactionHandler?.setHighlightedStop(null);
    this.layerManager?.clearHighlights();
    this.applySpotlight(null);

    this.applyFocusedObject({ type: 'zone', id: location_id });
    this.fitToZone(location_id);

    console.log(`Highlighted zone: ${location_id}`);
  }

  /**
   * Highlight a location group by revealing its member stops and fitting to
   * them. A group has no geometry of its own, so its stops are the highlight.
   */
  public highlightLocationGroup(location_group_id: string): void {
    this.interactionHandler?.setHighlightedStop(null);
    this.layerManager?.clearHighlights();
    this.applySpotlight(null);
    this.applyFocusedObject({ type: 'none' });

    const stop_ids = this.stopIdsForLocationGroup(location_group_id);
    this.layerManager?.setRouteStops([
      ...this.withAncestors(new Set(stop_ids)),
    ]);
    this.fitToStops(stop_ids);

    console.log(
      `Highlighted location group: ${location_group_id} (${stop_ids.length} stops)`
    );
  }

  /** Member stop ids of a location group, from location_group_stops.txt. */
  private stopIdsForLocationGroup(location_group_id: string): string[] {
    const rows = this.feed?.isOpen
      ? this.feed.table('location_group_stops')
      : [];
    return rows
      .filter(
        (row) => String(row.location_group_id ?? '') === location_group_id
      )
      .map((row) => String(row.stop_id ?? ''))
      .filter((stop_id) => stop_id !== '');
  }

  /** Fly to a single stop. No-op when it has no coordinates. */
  private flyToStop(stop_id: string): void {
    const stop = this.feed?.isOpen ? this.feed.byKey('stops', stop_id) : null;
    if (!stop || !hasValidCoords(stop)) {
      return;
    }

    this.autoFlyTo({
      center: [Number(stop.stop_lon), Number(stop.stop_lat)],
      zoom: CONFIG.STOP_FOCUS_ZOOM,
      duration: 1500,
      essential: true,
      padding: fitPadding(this.map!, 50, this.bottomPadding),
    });
  }

  /** Fit the viewport to a set of stops. No-op when none have coordinates. */
  private fitToStops(stop_ids: string[]): void {
    if (!this.map || stop_ids.length === 0) {
      return;
    }
    const bounds = this.boundsFor({ stop_ids });
    if (!bounds) {
      return;
    }
    this.autoFit(bounds, {
      padding: fitPadding(this.map, 80, this.bottomPadding),
      maxZoom: CONFIG.STOP_FOCUS_ZOOM,
    });
  }

  /** Fit the viewport to one zone's bounds. No-op if the zone has no geometry. */
  public fitToZone(location_id: string): void {
    if (!this.map) {
      return;
    }
    const bounds = this.boundsFor({ zone_ids: [location_id] });
    if (!bounds) {
      console.warn(`[MapController] No bounds for zone ${location_id}`);
      return;
    }
    this.autoFit(bounds, {
      padding: fitPadding(this.map, 80, this.bottomPadding),
      maxZoom: CONFIG.STOP_FOCUS_ZOOM,
      duration: 1000,
      essential: true,
    });
  }

  public getCenter(): { lng: number; lat: number } | null {
    return this.map ? this.map.getCenter() : null;
  }

  /** Move to a place picked from search and ring it. */
  public focusPlace(place: PlacePayload): void {
    if (!this.map) {
      return;
    }
    this.placeMarker ??= new SearchPlaceMarker(this.map);
    this.placeMarker.focus(place, fitPadding(this.map, 50, this.bottomPadding));
  }

  /**
   * Clear all highlights
   */
  private async handleEmptyClick(): Promise<void> {
    const obj = this.focusedObject;
    const feed = this.feed?.isOpen ? this.feed : null;

    let parentStopId: string | null = null;
    if (feed && obj.type === 'stop') {
      parentStopId = feed.byKey('stops', obj.id)?.parent_station || null;
    } else if (feed && obj.type === 'pathway') {
      const pw = feed.byKey('pathways', obj.id);
      const from = pw ? feed.byKey('stops', pw.from_stop_id ?? '') : null;
      parentStopId = from?.stop_id ?? null;
    }

    if (parentStopId) {
      this.applyFocusedObject({ type: 'stop', id: parentStopId });
      if (this.pageStateManager) {
        await this.pageStateManager.setPageState({
          type: 'stop',
          stop_id: parentStopId,
        });
      }
    } else {
      this.clearHighlights();
      this.callbacks.onEmptyClick?.();
    }
  }

  public clearHighlights(): void {
    this.interactionHandler?.setHighlightedStop(null);
    this.layerManager?.clearHighlights();
    this.applySpotlight(null);
    this.applyFocusedObject({ type: 'none' });
  }

  /**
   * Smoothly fly to show a specific route
   */
  private flyToRoute(route_id: string): void {
    const bounds = this.boundsFor({
      ...this.refsForRoute(route_id),
      route_ids: [route_id],
      include_shapes: true,
    });
    if (!bounds) {
      return;
    }

    this.autoFit(bounds, {
      padding: fitPadding(this.map!, 80, this.bottomPadding),
      duration: 2000,
      essential: true,
    });
  }

  /**
   * Fit map to show specific routes
   */
  public fitToRoutes(route_ids: string[]): void {
    const stop_ids = new Set<string>();
    const zone_ids = new Set<string>();
    const location_group_ids = new Set<string>();
    for (const route_id of route_ids) {
      const refs = this.refsForRoute(route_id);
      refs.stop_ids.forEach((id) => stop_ids.add(id));
      refs.zone_ids.forEach((id) => zone_ids.add(id));
      refs.location_group_ids.forEach((id) => location_group_ids.add(id));
    }

    const bounds = this.boundsFor({
      stop_ids,
      zone_ids,
      location_group_ids,
      route_ids,
      include_shapes: true,
    });
    if (!bounds) {
      return;
    }

    this.autoFit(bounds, {
      padding: fitPadding(this.map!, 50, this.bottomPadding),
    });
  }

  /**
   * Highlight all routes for a specific agency
   */
  public highlightAgencyRoutes(agency_id: string): void {
    const routes = this.feed!.table('routes');
    const agencies = this.feed!.table('agency');
    const acceptedIds = agencyRouteFilter(agency_id, agencies.length);
    const agencyRoutes = routes.filter((route) =>
      acceptedIds.includes(normalizeAgencyId(route.agency_id))
    );

    if (agencyRoutes.length === 0) {
      return;
    }

    const agencyRouteIds = agencyRoutes.map((r) => r.route_id);

    this.clearHighlights();
    this.applySpotlight(agencyRouteIds);
    this.fitToRoutes(agencyRouteIds);
  }

  // ========================================
  // MODE MANAGEMENT
  // ========================================

  /**
   * Set map interaction mode
   */
  public setMapMode(mode: MapMode): void {
    this.interactionHandler?.setMapMode(mode);
  }

  /**
   * Get current map mode
   */
  public getCurrentMode(): MapMode {
    return this.interactionHandler?.getCurrentMode() || MapMode.NAVIGATE;
  }

  /**
   * Toggle add stop mode
   */
  public toggleAddStopMode(): void {
    this.interactionHandler?.toggleAddStopMode();
  }

  /**
   * Toggle add pathway mode
   */
  public toggleAddPathwayMode(): void {
    this.interactionHandler?.toggleAddPathwayMode();
  }

  // ========================================
  // UI INTEGRATION METHODS
  // ========================================

  /**
   * Force map resize (for layout changes)
   */
  public resizeNow(): void {
    this.map?.resize();
  }

  public forceMapResize(): void {
    if (!this.map) {
      return;
    }

    // Clear any pending resize operations
    if (this.resizeTimeout) {
      clearTimeout(this.resizeTimeout);
    }

    // Wait for CSS transition to complete
    this.resizeTimeout = setTimeout(() => {
      const center = this.map!.getCenter();
      const zoom = this.map!.getZoom();

      this.map!.resize();

      // Restore center and zoom to prevent jumping
      this.map!.setCenter(center);
      this.map!.setZoom(zoom);

      this.resizeTimeout = null;
    }, 350);
  }

  /**
   * Highlight file data (legacy compatibility)
   */
  public highlightFileData(fileName: string): void {
    console.log(`Highlighting data for ${fileName}`);
    // Could be enhanced to highlight specific file types
  }

  // ========================================
  // EVENT HANDLERS
  // ========================================

  /**
   * Handle route click events
   */
  private async handleRouteClick(route_id: string): Promise<void> {
    console.log('Route clicked:', route_id);

    this.applyFocusedObject({ type: 'route', id: route_id });

    // Navigate using page state manager
    if (this.pageStateManager) {
      await this.pageStateManager.setPageState({ type: 'route', route_id });
    }

    // Legacy callback support
    if (this.callbacks.onRouteSelect) {
      this.callbacks.onRouteSelect(route_id);
    }
  }

  /**
   * Handle stop click events
   */
  private async handleStopClick(stop_id: string): Promise<void> {
    console.log('Stop clicked:', stop_id);

    this.applyFocusedObject({ type: 'stop', id: stop_id });

    // Navigate using page state manager
    if (this.pageStateManager) {
      await this.pageStateManager.setPageState({ type: 'stop', stop_id });
    }

    // Legacy callback support
    if (this.callbacks.onStopSelect) {
      this.callbacks.onStopSelect(stop_id);
    }
  }

  /**
   * Handle mode change events
   */
  private handleModeChange(mode: MapMode): void {
    console.log('Map mode changed to:', mode);

    if (this.callbacks.onModeChange) {
      this.callbacks.onModeChange(mode);
    }
  }

  /**
   * Handle pathway click events
   */
  private async handlePathwayClick(pathway_id: string): Promise<void> {
    console.log('Pathway clicked:', pathway_id);

    this.applyFocusedObject({ type: 'pathway', id: pathway_id });

    if (this.pageStateManager) {
      await this.pageStateManager.setPageState({
        type: 'pathway',
        pathway_id,
      });
    }

    if (this.callbacks.onPathwaySelect) {
      this.callbacks.onPathwaySelect(pathway_id);
    }
  }

  /**
   * Handle zone polygon click events: focus, fit, and open the zone page.
   */
  private async handleZoneClick(location_id: string): Promise<void> {
    console.log('Zone clicked:', location_id);

    this.applyFocusedObject({ type: 'zone', id: location_id });
    this.fitToZone(location_id);

    if (this.pageStateManager) {
      await this.pageStateManager.setPageState({
        type: 'zone',
        location_id,
      });
    }

    this.callbacks.onZoneSelect?.(location_id);
  }

  /**
   * Handle stop drag completion
   */
  private async handleStopDragComplete(
    stop_id: string,
    lat: number,
    lng: number
  ): Promise<void> {
    console.log(`Stop ${stop_id} dragged to: ${lat}, ${lng}`);

    try {
      if (isNaN(lat) || isNaN(lng)) {
        throw new Error(
          t('coords.invalid', { lat: String(lat), lng: String(lng) })
        );
      }
      if (lat < -90 || lat > 90) {
        throw new Error(t('coords.lat', { lat: String(lat) }));
      }
      if (lng < -180 || lng > 180) {
        throw new Error(t('coords.lng', { lng: String(lng) }));
      }
      const stop = this.feed?.byKey('stops', stop_id);
      if (!stop) {
        throw new Error(`Stop ${stop_id} not found`);
      }
      // The edit listener redraws the stops and pathways.
      await this.feed!.apply([
        updateOp('stops', stop, {
          stop_lat: lat.toString(),
          stop_lon: lng.toString(),
        }),
      ]);
      console.log(`Updated coordinates for stop ${stop_id}`);
    } catch (error) {
      console.error(`Failed to update coordinates for stop ${stop_id}:`, error);

      // Show error notification
      const errorMessage =
        error instanceof Error ? error.message : t('db.unknownError');
      notify.error(t('map.coordsFailed', { message: errorMessage }));

      // Refresh map to revert visual changes
      await this.updateMap();
    }
  }

  /**
   * Handle pathway creation: rebuild pathways layer and navigate to the new pathway
   */
  private async handlePathwayCreated(pathway_id: string): Promise<void> {
    console.log(`Pathway ${pathway_id} created`);
    const expandedStation = this.deriveExpandedStation();
    if (expandedStation) {
      this.layerManager?.invalidateCoordResolver();
      this.layerManager?.rebuildPathwaysSource(expandedStation);
    }
    if (this.pageStateManager) {
      await this.pageStateManager.setPageState({ type: 'pathway', pathway_id });
    }
    this.callbacks.onPathwaySelect?.(pathway_id);
  }

  /**
   * Handle stop creation
   */
  private handleStopCreated(stop_id: string): void {
    console.log(`Stop ${stop_id} created`);

    // Update layer data to show the new stop
    this.layerManager?.invalidateCoordResolver();
    this.layerManager?.updateStopsData();

    // Focus it: a focused stop is exempt from the zoom fade, so the stop that
    // was just made is drawn and clickable whatever the zoom.
    this.layerManager?.setFocusedStop(stop_id);

    // Below the fade band the map is usually still at the default world view
    // (an empty feed gives fitMapToData nothing to fit), so move to the stop.
    if (this.map && this.map.getZoom() < CONFIG.STOP_FADE_ZOOM_MAX) {
      const stop = this.feed?.byKey('stops', stop_id);
      if (stop && hasValidCoords(stop)) {
        console.log(`[MapController] easing to new stop ${stop_id}`);
        this.map.easeTo({
          center: [Number(stop.stop_lon), Number(stop.stop_lat)],
          zoom: CONFIG.STOP_FADE_ZOOM_MAX,
          duration: 800,
        });
      }
    }
  }

  // ========================================
  // LEGACY COMPATIBILITY METHODS
  // ========================================

  /**
   * Legacy compatibility methods for existing code
   */
  public focusRoute(route_id: string): void {
    this.highlightRoute(route_id);
  }

  public focusStop(stop_id: string): void {
    this.highlightStop(stop_id);
  }

  public clearFocus(): void {
    this.clearHighlights();
  }

  public setRouteSelectCallback(callback: (route_id: string) => void): void {
    this.callbacks.onRouteSelect = callback;
  }

  public setStopSelectCallback(callback: (stop_id: string) => void): void {
    this.callbacks.onStopSelect = callback;
  }

  public refreshStops(): void {
    this.layerManager?.invalidateCoordResolver();
    this.layerManager?.updateStopsData();
  }

  /** Re-read locations.geojson into the zone polygons after a geometry edit. */
  public refreshZones(): void {
    this.layerManager?.updateZonesLayer();
  }

  public setModeChangeCallback(callback: (mode: MapMode) => void): void {
    this.callbacks.onModeChange = callback;
  }

  // ========================================
  // LIFECYCLE MANAGEMENT
  // ========================================

  /**
   * Destroy the map controller and clean up resources
   */
  public destroy(): void {
    if (!this.isInitialized) {
      return;
    }

    // Clean up timeout
    if (this.resizeTimeout) {
      clearTimeout(this.resizeTimeout);
      this.resizeTimeout = null;
    }

    // Destroy modules
    this.routeRenderer?.destroy();
    this.interactionHandler?.destroy();
    this.basemapControl?.destroy();
    // LayerManager doesn't need explicit cleanup as it's tied to the map

    // Clean up map
    if (this.map) {
      this.map.remove();
      this.map = null;
    }

    // Reset state
    this.routeRenderer = null;
    this.layerManager = null;
    this.interactionHandler = null;
    this.basemapControl = null;
    this.feed = null;
    this.pageStateManager = null;
    this.callbacks = {};
    this.focusedObject = { type: 'none' };
    this.appliedStopsFilterKey = '';
    this.isInitialized = false;

    console.log('MapController destroyed');
  }

  /**
   * Get debug information about the map controller
   */
  public getDebugInfo(): object {
    return {
      isInitialized: this.isInitialized,
      mapElementId: this.mapElementId,
      hasMap: !!this.map,
      hasRouteRenderer: !!this.routeRenderer,
      hasLayerManager: !!this.layerManager,
      hasInteractionHandler: !!this.interactionHandler,
      hasBasemapControl: !!this.basemapControl,
      hasFeed: !!this.feed?.isOpen,
      hasPageStateManager: !!this.pageStateManager,
      currentMode: this.getCurrentMode(),
      currentBasemap: this.basemapControl?.getCurrentBasemap(),
      mapCenter: this.map?.getCenter(),
      mapZoom: this.map?.getZoom(),
      routeDataCount: this.routeRenderer?.getRouteBounds().size || 0,
      focusedObject: this.focusedObject,
    };
  }

  // ========================================
  // BASEMAP CONTROL METHODS
  // ========================================

  /**
   * Get the basemap control instance
   */
  public getBasemapControl(): BasemapControl | null {
    return this.basemapControl;
  }

  /**
   * Set basemap style
   */
  public setBasemap(basemapId: string): void {
    this.basemapControl?.setBasemap(basemapId);
  }
}
