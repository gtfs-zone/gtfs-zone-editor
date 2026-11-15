/**
 * Application-wide configuration constants.
 * All magic numbers live here: import CONFIG rather than inlining literals.
 */
export const CONFIG = {
  // IndexedDB database of the previous storage layer, deleted at boot.
  LEGACY_DB_NAME: 'GTFSZoneDB',

  // IndexedDB: how long an open or delete request may sit unanswered before we
  // treat the database as wedged. A request queued behind a blocked
  // version-change operation fires no event at all, so without this the boot
  // hangs forever with nothing logged.
  DB_REQUEST_TIMEOUT_MS: 8_000,

  // Editor (table view)
  DEBOUNCE_DELAY: 500, // ms before flushing pending cell updates
  // Rows the Files grid loads; a longer table shows its first rows only.
  FILES_GRID_MAX_ROWS: 100_000,
  CLUSTERIZE_ROWS_IN_BLOCK: 50,
  CLUSTERIZE_BLOCKS_IN_CLUSTER: 4,

  // Enum menus: option count above which the searchable modal opens instead.
  ENUM_MODAL_THRESHOLD: 15,

  // Renaming an ID: cascade size above which the impact modal warns before
  // applying. A stop rename on a city feed rewrites every stop_times row that
  // stops there, which is slow but fine - the patch log holds it.
  RENAME_CASCADE_WARN: 5_000,

  // Feed worker: IndexedDB holding the patch log and the pointer to the
  // active OPFS base file.
  FEED_DB_NAME: 'GTFSZoneFeed',
  // Patches to replay at boot (both directions, bridge included) above which
  // the patch log is folded into a new base file.
  FEED_FOLD_PATCHES: 500,
  // Feed validation in the worker: work per `validateStep` call, and rows
  // between checks of that budget.
  VALIDATE_STEP_MS: 30,
  VALIDATE_CHUNK_ROWS: 5_000,
  // Export in the worker: work per `exportStep` call, CSV rows encoded and
  // zipped at a time, and zip output gathered per Blob part.
  EXPORT_STEP_MS: 50,
  EXPORT_CHUNK_ROWS: 5_000,
  EXPORT_BLOB_PART_BYTES: 16 * 1024 * 1024,

  // Map navigation: zoom level used when focusing a single stop or station.
  // For stations with multiple child stops, this is the max zoom; fitBounds
  // will zoom out further if children don't fit at this level so subsidiaries
  // aren't cut off.
  STOP_FOCUS_ZOOM: 19,

  // Map spotlight: zoom range over which plain stops fade in/out. Shared
  // between LayerManager's fade-opacity expression and its click-area hit
  // radius so hidden stops are never hoverable/clickable.
  STOP_FADE_ZOOM_MIN: 10.5,
  STOP_FADE_ZOOM_MAX: 12.5,

  // Map spotlight: the same fade applied to stations and child nodes, but
  // pitched lower. Stations are far more spaced out than plain stops, so they
  // can stay legible well past the zoom where a pile of stops turns to mush.
  // Must sit below STOP_FADE_ZOOM_MIN or the two bands overlap and stations
  // fade back out as plain stops fade in.
  STATION_FADE_ZOOM_MIN: 7.5,
  STATION_FADE_ZOOM_MAX: 9.5,

  // Map spotlight: below this many stops both fade bands are skipped and every
  // stop draws at full opacity. The fade exists to stop thousands of dots
  // piling up; a feed being authored from scratch has no pile to avoid.
  STOP_FADE_MIN_STOPS: 50,

  // Map spotlight: opacity/width treatment applied when a route (and its
  // stops) is selected. Non-matching routes/stops dim; the matched route's
  // line and casing get a width bump.
  SPOTLIGHT_STOP_DIM: 0.15,
  SPOTLIGHT_ROUTE_DIM: 0.2,
  SPOTLIGHT_LINE_BUMP: 1.35,
  SPOTLIGHT_CASING_BUMP: 1.3,

  // Map spotlight: zoom range over which the direction arrows on the single
  // spotlighted route fade in, and their opacity once faded in. Sits above
  // STOP_FADE_ZOOM_MAX so arrows are the last thing to appear as you zoom in.
  ROUTE_ARROW_FADE_ZOOM_MIN: 12,
  ROUTE_ARROW_FADE_ZOOM_MAX: 13.5,
  ROUTE_ARROW_OPACITY: 0.85,

  // Route lines: Douglas-Peucker tolerance in degrees applied in the worker
  // before the lines reach the map (1e-5 is about 1m).
  ROUTE_LINE_SIMPLIFY_DEG: 1e-5,
  // Routes GeoJSON source: deepest zoom tiled (deeper zooms overscale it),
  // simplification in tile pixels and tile buffer.
  ROUTES_SOURCE_MAXZOOM: 14,
  ROUTES_SOURCE_TOLERANCE: 0.5,
  ROUTES_SOURCE_BUFFER: 64,

  // Stop layers: lowest zoom drawn once the zoom fade is on (see
  // STOP_FADE_MIN_STOPS). Below it the fade already hides every stop but the
  // focused and spotlighted ones; routes carry the overview there.
  STOPS_MIN_ZOOM: 7.5,

  // Map spotlight: line-sort-key applied to the focused route so it paints
  // above every other route. Far above any natural key (max ~90999).
  SPOTLIGHT_SORT_KEY: 1_000_000,

  // Which day a week starts on in the calendar input and the month grid, 0 for
  // Sunday through 6 for Saturday. The other gtfs.zone apps answer this
  // differently, so `calendar-input.ts` takes it as an argument rather than
  // holding an opinion.
  WEEK_START: 0,

  // Boot timing: set to true locally to emit console.time measurements for each
  // init stage. Leave false in production (logs are noisy and measured overhead
  // accumulates in tight loops).
  DEBUG_BOOT: false,

  // Where a path-only feed URL resolves to. Always the deployed feed server:
  // unlike gtfs-zone-rt-viewer, this app has no local realtime stack to talk to in
  // dev.
  RT_BASE: 'https://rt.gtfs.zone',
} as const;
