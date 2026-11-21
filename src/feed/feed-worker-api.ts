/**
 * The editor's methods on top of the store worker (runs in the worker).
 *
 * The worker owns the patch log: every edit, undo, redo and jump applies to
 * the store and is written to the log before the call replies. A failed
 * apply leaves neither a store change nor a logged patch; a failed write
 * takes the store change back.
 *
 * Lifecycle, driven by `feed-boot.ts`:
 * - import: `load({ url | file })`, then `commitImport(label, source)`,
 *   which stores it as a new feed and makes it active.
 * - restore: `load({ base })`, then `open(feedId, baseName)`; `compact()`
 *   folds the log into a new base when `open` says it is due.
 *
 * Making a feed active deletes every other unedited stored feed.
 */

import type {
  FeedStore,
  Row,
} from 'gtfs-zone-web-common/gtfs/store/feed-store';
import type { StoreContext } from 'gtfs-zone-web-common/gtfs/store/store-worker-core';
import {
  deleteBaseFile,
  saveBaseFile,
  sweepBaseFiles,
} from 'gtfs-zone-web-common/gtfs/store/opfs-base';
import { isQuotaError } from 'gtfs-zone-web-common/util/storage';
import Papa from 'papaparse';
import { CONFIG } from '../config';
import { QUOTA_MESSAGE } from './quota';
import type { FeedPatch, FeedPatchRecord, PatchRename } from '../types/patch';
import { applyPatch, applyPatches, rowByKey } from './patch-apply';
import { patchTargets } from './patch-build';
import { FeedValidator, type ValidateStep } from './feed-validate';
import { FeedExporter, type ExportStep } from './feed-export';
import { MapTiles, type MapRoutesBuilt, type MapTileLayer } from './map-tiles';
import {
  FeedDb,
  IdbFeedLog,
  MemoryFeedLog,
  newFeedId,
  type FeedLog,
  type FeedState,
  type NetworksMode,
} from './feed-log';

export type Persistence = 'opfs' | 'session';

export interface Versions {
  current: number;
  head: number;
  canUndo: boolean;
  canRedo: boolean;
}

/** What a history move did: the UI follows the renames, in order. */
export interface Moved {
  versions: Versions;
  renames: PatchRename[];
  /** Tables and non-table entries the moved patches write. */
  tables: string[];
  files: string[];
  /** The patch, when the move went over exactly one. */
  patch?: FeedPatch;
}

export interface Opened {
  state: FeedState;
  persistence: Persistence;
  /** Patches replayed onto the base (bridge included). */
  replayed: number;
  /** True when `compact()` should run before the session starts. */
  foldDue: boolean;
}

/**
 * One condition of `where`: the column's value equals `eq`, is one of `in`,
 * or sorts below `lt` / above `gt` (string order, so YYYYMMDD dates work).
 * Conditions in a list must all hold.
 */
export interface Cond {
  col: string;
  eq?: string;
  in?: string[];
  lt?: string;
  gt?: string;
}

function matcher(conds: Cond[]): (get: (col: string) => string) => boolean {
  const sets = conds.map((c) => (c.in ? new Set(c.in) : null));
  return (get) =>
    conds.every((c, i) => {
      const v = get(c.col);
      return (
        (c.eq === undefined || v === c.eq) &&
        (sets[i] === null || sets[i].has(v)) &&
        (c.lt === undefined || v < c.lt) &&
        (c.gt === undefined || v > c.gt)
      );
    });
}

/** stop_times rows matching `conds`, using the trip or stop index when one applies. */
function stopTimesWhere(s: FeedStore, conds: Cond[]): Row[] {
  const match = matcher(conds);
  // The values a column is limited to, or null when no condition limits it.
  const valuesOf = (col: string): string[] | null => {
    const c = conds.find((x) => x.col === col && (x.eq !== undefined || x.in));
    return c ? (c.eq !== undefined ? [c.eq] : c.in!) : null;
  };
  const tripIds = valuesOf('trip_id');
  const stopIds = valuesOf('stop_id');
  const trips =
    tripIds ??
    (stopIds
      ? [...new Set(stopIds.flatMap((id) => s.tripsAtStop(id)))]
      : s.tripsWithStopTimes());
  const out: Row[] = [];
  for (const id of trips) {
    for (const row of s.stopTimesForTrip(id)) {
      if (match((c) => row[c] ?? '')) {
        out.push(row);
      }
    }
  }
  return out;
}

/** Rows of `table` matching `conds`, in table order. */
function where(s: FeedStore, table: string, conds: Cond[]): Row[] {
  if (!s.hasTable(table)) {
    return [];
  }
  if (table === 'stop_times') {
    return stopTimesWhere(s, conds);
  }
  if (table === 'shapes') {
    const match = matcher(conds);
    const shapeId = conds.find((c) => c.col === 'shape_id')?.eq;
    const out: Row[] = [];
    for (const id of shapeId !== undefined ? [shapeId] : s.shapeIds()) {
      for (const row of s.shapeRows(id)) {
        if (match((c) => row[c] ?? '')) {
          out.push(row);
        }
      }
    }
    return out;
  }
  const eq = conds.find((c) => c.eq !== undefined);
  if (eq) {
    const match = matcher(conds);
    return s
      .find(table, eq.col, eq.eq!)
      .map((h) => h.row)
      .filter((row) => match((c) => row[c] ?? ''));
  }
  const cols = [...new Set(conds.map((c) => c.col))];
  const match = matcher(conds);
  const ids: number[] = [];
  s.scan(table, cols, (values, id) => {
    if (match((c) => values[cols.indexOf(c)])) {
      ids.push(id);
    }
  });
  return ids.map((id) => s.row(table, id)!);
}

/** The first `limit` rows of `table`, in table order (per trip / shape for the grouped ones). */
function head(s: FeedStore, table: string, limit: number): Row[] {
  if (!s.hasTable(table)) {
    return [];
  }
  if (table !== 'stop_times' && table !== 'shapes') {
    return s.rows(table, 0, limit).map((r) => r.row);
  }
  const out: Row[] = [];
  const groups = table === 'stop_times' ? s.tripsWithStopTimes() : s.shapeIds();
  for (const id of groups) {
    const rows =
      table === 'stop_times' ? s.stopTimesForTrip(id) : s.shapeRows(id);
    for (const row of rows) {
      if (out.length >= limit) {
        return out;
      }
      out.push(row);
    }
  }
  return out;
}

/** Distinct non-empty values of `col` in `table`. */
function distinct(s: FeedStore, table: string, col: string): string[] {
  const out = new Set<string>();
  if (!s.hasTable(table)) {
    return [];
  }
  if (table === 'stop_times') {
    for (const id of s.tripsWithStopTimes()) {
      for (const row of s.stopTimesForTrip(id)) {
        const v = row[col] ?? '';
        if (v !== '') {
          out.add(v);
        }
      }
    }
    return [...out];
  }
  if (table === 'shapes') {
    if (col === 'shape_id') {
      return s.shapeIds();
    }
    throw new Error(`[FeedWorker] distinct on shapes.${col} is not supported`);
  }
  s.scan(table, [col], ([v]) => {
    if (v !== '') {
      out.add(v);
    }
  });
  return [...out];
}

/** What a route's stop_times reference, by kind. */
export interface RouteRefs {
  stops: string[];
  zones: string[];
  groups: string[];
}

/**
 * Every route's stop_times references. One stop_times read per distinct
 * stop list: trips sharing a pattern share every non-time column.
 */
function routeRefs(s: FeedStore): Record<string, RouteRefs> {
  const routeOf = new Map<string, string>();
  if (s.hasTable('trips')) {
    s.scan('trips', ['trip_id', 'route_id'], ([trip, route]) => {
      routeOf.set(trip, route);
    });
  }
  const acc = new Map<
    string,
    { stops: Set<string>; zones: Set<string>; groups: Set<string> }
  >();
  if (!s.hasTable('stop_times')) {
    return {};
  }
  s.forEachStopList((_stops, tripIds) => {
    const rows = s.stopTimesForTrip(tripIds[0]);
    const routes = new Set<string>();
    for (const id of tripIds) {
      const route = routeOf.get(id);
      if (route !== undefined) {
        routes.add(route);
      }
    }
    for (const route of routes) {
      let a = acc.get(route);
      if (!a) {
        a = { stops: new Set(), zones: new Set(), groups: new Set() };
        acc.set(route, a);
      }
      for (const row of rows) {
        if (row.stop_id) {
          a.stops.add(row.stop_id);
        }
        if (row.location_id) {
          a.zones.add(row.location_id);
        }
        if (row.location_group_id) {
          a.groups.add(row.location_group_id);
        }
      }
    }
  });
  const out: Record<string, RouteRefs> = {};
  for (const [route, a] of acc) {
    out[route] = {
      stops: [...a.stops],
      zones: [...a.zones],
      groups: [...a.groups],
    };
  }
  return out;
}

/** Date range of one service's calendar_dates, '' where there is none. */
export interface ExceptionBounds {
  /** Over every exception. */
  first: string;
  last: string;
  /** Over added exceptions (exception_type 1) only. */
  addedFirst: string;
  addedLast: string;
}

/** calendar_dates date bounds per service_id. */
function exceptionBounds(s: FeedStore): Record<string, ExceptionBounds> {
  const out: Record<string, ExceptionBounds> = {};
  if (!s.hasTable('calendar_dates')) {
    return out;
  }
  s.scan(
    'calendar_dates',
    ['service_id', 'date', 'exception_type'],
    ([service, date, type]) => {
      const b = (out[service] ??= {
        first: date,
        last: date,
        addedFirst: '',
        addedLast: '',
      });
      if (date < b.first) {
        b.first = date;
      }
      if (date > b.last) {
        b.last = date;
      }
      if (Number(type) === 1) {
        if (b.addedFirst === '' || date < b.addedFirst) {
          b.addedFirst = date;
        }
        if (date > b.addedLast) {
          b.addedLast = date;
        }
      }
    }
  );
  return out;
}

/** Point and trip counts of one shape, for the shapes modal list. */
export interface ShapeSummary {
  points: number;
  trips: number;
}

/** Point and trip counts of every shape. */
function shapeSummary(s: FeedStore): Record<string, ShapeSummary> {
  const out: Record<string, ShapeSummary> = {};
  if (s.hasTable('shapes')) {
    for (const id of s.shapeIds()) {
      out[id] = { points: s.shapeCoords(id).length / 2, trips: 0 };
    }
  }
  if (s.hasTable('trips')) {
    s.scan('trips', ['shape_id'], ([shape]) => {
      const usage = out[shape];
      if (usage) {
        usage.trips++;
      }
    });
  }
  return out;
}

/** What one shape's row shows once it is on screen. */
export interface ShapeDetail {
  /** Distinct [route_id, service_id, direction_id] of the trips using it. */
  timetables: [string, string, string][];
  /** First and last stop of one trip using it, when it has two or more. */
  origin?: string;
  destination?: string;
}

/** Timetables and endpoints of the shapes `ids` names. */
function shapeDetails(
  s: FeedStore,
  ids: string[]
): Record<string, ShapeDetail> {
  const out: Record<string, ShapeDetail> = {};
  for (const id of ids) {
    out[id] = { timetables: [] };
  }
  if (!s.hasTable('trips')) {
    return out;
  }
  const seen = new Map<string, Set<string>>();
  const firstTrip = new Map<string, string>();
  s.scan(
    'trips',
    ['shape_id', 'trip_id', 'route_id', 'service_id', 'direction_id'],
    ([shape, trip, route, service, direction]) => {
      const detail = out[shape];
      if (!detail) {
        return;
      }
      if (!firstTrip.has(shape)) {
        firstTrip.set(shape, trip);
      }
      const keys = seen.get(shape) ?? new Set<string>();
      seen.set(shape, keys);
      const key = `${route}\u0000${service}\u0000${direction}`;
      if (!keys.has(key)) {
        keys.add(key);
        detail.timetables.push([route, service, direction]);
      }
    }
  );
  if (s.hasTable('stop_times')) {
    for (const [shape, trip] of firstTrip) {
      const stops = s.tripStops(trip);
      if (stops.length >= 2) {
        out[shape].origin = stops[0].stop_id;
        out[shape].destination = stops[stops.length - 1].stop_id;
      }
    }
  }
  return out;
}

/** How far `recover` brought the store towards the stored version. */
/** A non-table entry parsed as CSV, for a read-only view. */
export interface FileTable {
  header: string[];
  /** The first rows after the header, at most the limit asked for. */
  rows: string[][];
  /** Non-empty lines after the header. */
  total: number;
}

/** Non-empty lines of an entry, counted on the bytes without decoding. */
function countLines(bytes: Uint8Array): number {
  const NEWLINE = 0x0a;
  const CR = 0x0d;
  let lines = 0;
  let filled = false;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === NEWLINE) {
      lines += filled ? 1 : 0;
      filled = false;
    } else if (b !== CR && b !== 0x20 && b !== 0x09) {
      filled = true;
    }
  }
  return lines + (filled ? 1 : 0);
}

export interface Recovered {
  /** Patches applied (bridge included) and patches the stored version needs. */
  applied: number;
  total: number;
  /** Why the replay stopped early. */
  error?: string;
}

export interface Imported {
  state: FeedState;
  persistence: Persistence;
  /** Routes whose `network_id` was ignored for networks.txt. */
  ignoredRouteNetworks: number;
}

/** Where an import came from, for the library's newer-version check. */
export interface ImportSource {
  url: string | null;
  /** YYYY-MM-DD. */
  modified: string | null;
}

/** Whether the browser gives this worker OPFS; without it, session only. */
async function hasOpfs(): Promise<boolean> {
  try {
    if (!navigator.storage?.getDirectory) {
      throw new Error('navigator.storage.getDirectory is missing');
    }
    await navigator.storage.getDirectory();
    return true;
  } catch (err) {
    console.warn('[FeedWorker] no OPFS; this session saves nothing', err);
    return false;
  }
}

/** `err`, or a message the user can act on when it is a full disk. */
function quotaAware(err: unknown): unknown {
  if (isQuotaError(err)) {
    console.error('[FeedWorker] storage quota exceeded', err);
    return new Error(QUOTA_MESSAGE, { cause: err });
  }
  return err;
}

function newBaseName(): string {
  const rand = Math.floor(Math.random() * 1e9).toString(36);
  return `base-${Date.now().toString(36)}-${rand}.bin`;
}

/** Save a base and return its size, turning a full disk into a clear message. */
async function saveBase(
  store: FeedStore,
  ctx: StoreContext,
  name: string
): Promise<number> {
  try {
    return await saveBaseFile(store, ctx.stream(), name);
  } catch (err) {
    // A partial file is left unreferenced; the next sweep removes it.
    throw quotaAware(err);
  }
}

/**
 * Expand `routes.network_id` into networks + route_networks, or fill in the
 * networks route_networks names but networks.txt lacks. Import state, not
 * an edit: it is folded into the base.
 */
function normalizeNetworks(s: FeedStore): {
  mode: NetworksMode;
  ignored: number;
} {
  const has = (t: string) => s.hasTable(t) && (s.counts()[t] ?? 0) > 0;
  const routeNetworkIds = (): { routeId: string; networkId: string }[] => {
    const out: { routeId: string; networkId: string }[] = [];
    s.scan('routes', ['route_id', 'network_id'], ([routeId, networkId]) => {
      if (networkId.trim() !== '' && routeId !== '') {
        out.push({ routeId, networkId: networkId.trim() });
      }
    });
    return out;
  };

  if (has('networks') || has('route_networks')) {
    const defined = new Set<string>();
    if (s.hasTable('networks')) {
      s.scan('networks', ['network_id'], ([id]) => {
        if (id !== '') {
          defined.add(id);
        }
      });
    }
    const missing = new Set<string>();
    if (s.hasTable('route_networks')) {
      s.scan('route_networks', ['network_id'], ([id]) => {
        if (id !== '' && !defined.has(id)) {
          missing.add(id);
        }
      });
    }
    if (missing.size > 0) {
      console.warn(
        `[Networks] ${missing.size} network(s) referenced by route_networks.txt are missing from networks.txt, synthesizing them`
      );
      s.ensureTable('networks', ['network_id', 'network_name']);
      for (const id of missing) {
        s.insertRow('networks', { network_id: id, network_name: '' });
      }
    }
    const ignored = s.hasTable('routes') ? routeNetworkIds().length : 0;
    if (ignored > 0) {
      console.warn(
        `[Networks] ignoring routes.network_id on ${ignored} route(s): the feed also defines networks in its own files`
      );
    }
    return { mode: 'files', ignored };
  }

  const assignments = s.hasTable('routes') ? routeNetworkIds() : [];
  if (assignments.length === 0) {
    console.log('[Networks] feed defines no networks');
    return { mode: 'inline', ignored: 0 };
  }
  const ids = new Set(assignments.map((a) => a.networkId));
  console.log(
    `[Networks] expanding routes.network_id into ${ids.size} network(s) and ${assignments.length} assignment(s)`
  );
  s.ensureTable('networks', ['network_id', 'network_name']);
  s.ensureTable('route_networks', ['network_id', 'route_id']);
  for (const id of ids) {
    s.insertRow('networks', { network_id: id, network_name: '' });
  }
  for (const a of assignments) {
    s.insertRow('route_networks', {
      network_id: a.networkId,
      route_id: a.routeId,
    });
  }
  return { mode: 'inline', ignored: 0 };
}

function renameOf(
  patch: FeedPatch,
  dir: 'forward' | 'inverse'
): PatchRename | null {
  if (patch.op !== 'batch' || !patch.rename) {
    return null;
  }
  const r = patch.rename;
  return dir === 'forward' ? { ...r } : { ...r, from: r.to, to: r.from };
}

export function feedWorkerApi(ctx: StoreContext) {
  const opfs = hasOpfs();
  const db = new FeedDb();
  /** The log of the feed this worker holds, once bound. */
  let log: FeedLog | null = null;
  let state: FeedState | null = null;
  /** Bumped before every store change an edit or history move makes. */
  let revision = 0;
  const validator = new FeedValidator();
  const exporter = new FeedExporter();
  const mapTiles = new MapTiles();

  const bindLog = async (feedId: string): Promise<FeedLog> => {
    if (log) {
      throw new Error('[FeedWorker] a feed is already bound to this worker');
    }
    log = (await opfs) ? new IdbFeedLog(feedId, db) : new MemoryFeedLog(feedId);
    return log;
  };
  const getLog = async (): Promise<FeedLog> => {
    if (!log) {
      throw new Error('[FeedWorker] no feed bound; call open or commitImport');
    }
    return log;
  };
  const persistence = async (): Promise<Persistence> =>
    (await opfs) ? 'opfs' : 'session';

  const requireState = (): FeedState => {
    if (!state) {
      throw new Error('[FeedWorker] no feed opened; call open or commitImport');
    }
    return state;
  };

  /** `s` with its counts taken from the store as it is now. */
  const counted = (s: FeedState): FeedState => {
    const c = ctx.store().counts();
    return {
      ...s,
      counts: {
        routes: c.routes ?? 0,
        stops: c.stops ?? 0,
        trips: c.trips ?? 0,
      },
    };
  };

  const versions = (): Versions => {
    const s = requireState();
    return {
      current: s.currentVersion,
      head: s.headVersion,
      canUndo: s.currentVersion > 0,
      canRedo: s.currentVersion < s.headVersion,
    };
  };

  /** Patches leading from version `from` to `to`, in the order they apply. */
  const path = async (
    log: FeedLog,
    from: number,
    to: number
  ): Promise<{ patches: FeedPatch[]; dir: 'forward' | 'inverse' }> => {
    if (to >= from) {
      const recs = await log.patches(from + 1, to);
      return { patches: recs.map((r) => r.patch), dir: 'forward' };
    }
    const recs = await log.patches(to + 1, from);
    return { patches: recs.map((r) => r.patch).reverse(), dir: 'inverse' };
  };

  /**
   * Apply a history move to the store, then save the new pointers. When the
   * save fails, the store is moved back.
   */
  const move = async (
    patches: FeedPatch[],
    dir: 'forward' | 'inverse',
    target: FeedState
  ): Promise<Moved> => {
    let next = target;
    const log = await getLog();
    const store = ctx.store();
    revision++;
    applyPatches(store, patches, dir);
    next = counted(next);
    try {
      await log.saveState(next);
    } catch (err) {
      const back = dir === 'forward' ? 'inverse' : 'forward';
      applyPatches(store, [...patches].reverse(), back);
      throw quotaAware(err);
    }
    state = next;
    const renames = patches
      .map((p) => renameOf(p, dir))
      .filter((r): r is PatchRename => r !== null);
    const tables = new Set<string>();
    const files = new Set<string>();
    for (const p of patches) {
      const t = patchTargets(p);
      t.tables.forEach((x) => tables.add(x));
      t.files.forEach((x) => files.add(x));
    }
    console.log(
      `[FeedWorker] moved ${dir} over ${patches.length} patch(es) to version ${next.currentVersion}`
    );
    return {
      versions: versions(),
      renames,
      tables: [...tables],
      files: [...files],
      ...(patches.length === 1 && { patch: patches[0] }),
    };
  };

  /** Point the log at `name`, deleting the file again if that fails. */
  const commitBase = async (
    log: FeedLog,
    next: FeedState,
    clearPatches: boolean
  ): Promise<void> => {
    try {
      await log.commitBase(next, clearPatches);
    } catch (err) {
      if (next.baseName) {
        await deleteBaseFile(next.baseName).catch((e: unknown) =>
          console.warn(`[FeedWorker] could not remove ${next.baseName}`, e)
        );
      }
      throw err;
    }
  };

  /** Remove base files no stored feed points at. */
  const sweep = async (): Promise<void> => {
    try {
      const gone = await sweepBaseFiles(await db.baseNames());
      if (gone.length) {
        console.log(`[FeedWorker] swept ${gone.length} unused base file(s)`);
      }
    } catch (err) {
      console.warn('[FeedWorker] base file sweep failed', err);
    }
  };

  const edit = async (patch: FeedPatch): Promise<Versions> => {
    const s = requireState();
    const log = await getLog();
    const store = ctx.store();
    revision++;
    applyPatch(store, patch, 'forward');
    try {
      state = await log.append(counted(s), patch);
    } catch (err) {
      applyPatch(store, patch, 'inverse');
      throw quotaAware(err);
    }
    console.log(`[FeedWorker] recorded patch ${state.currentVersion}`);
    return versions();
  };

  /**
   * Make the bound feed active and remove the unedited feeds that evicts.
   * A failure here is logged, not thrown: the feed itself is stored.
   */
  const activate = async (): Promise<void> => {
    const l = await getLog();
    try {
      const { state: next, evicted } = await l.activate(requireState());
      state = next;
      for (const name of evicted) {
        await deleteBaseFile(name).catch((e: unknown) =>
          console.warn(`[FeedWorker] could not remove ${name}`, e)
        );
      }
    } catch (err) {
      console.error('[FeedWorker] could not mark the feed active', err);
    }
    if (l.persistent) {
      await sweep();
    }
  };

  const decode = (bytes: Uint8Array | null): string | null =>
    bytes === null ? null : new TextDecoder().decode(bytes);

  return {
    persistence,

    /**
     * After `load({ url | file })`: normalise, fold that into the base, save
     * it as a new stored feed with an empty log, and make it active.
     */
    commitImport: async (
      label: string,
      source: ImportSource
    ): Promise<Imported> => {
      if (state) {
        throw new Error('[FeedWorker] a feed is already open in this worker');
      }
      const { mode, ignored } = normalizeNetworks(ctx.store());
      if (ctx.store().hasEdits()) {
        ctx.replaceStore(ctx.store().fold());
      }
      const log = await bindLog(newFeedId());
      const feedVersion = ctx.store().hasTable('feed_info')
        ? (ctx.store().rows('feed_info', 0, 1)[0]?.row.feed_version ?? null)
        : null;
      const next: FeedState = counted({
        id: log.feedId,
        baseName: log.persistent ? newBaseName() : '',
        baseBytes: 0,
        label,
        anchorVersion: 0,
        currentVersion: 0,
        headVersion: 0,
        bridgeLength: 0,
        networksMode: mode,
        extensionColumns: {},
        importedAt: Date.now(),
        importFeedVersion: feedVersion,
        lastOpened: Date.now(),
        sourceUrl: source.url,
        sourceModified: source.modified,
        counts: { routes: 0, stops: 0, trips: 0 },
      });
      if (next.baseName) {
        next.baseBytes = await saveBase(ctx.store(), ctx, next.baseName);
      }
      try {
        await commitBase(log, next, true);
      } catch (err) {
        throw quotaAware(err);
      }
      state = next;
      await activate();
      console.log(
        `[FeedWorker] imported ${label} as ${next.id} (${next.baseName || 'session'})`
      );
      return {
        state: { ...requireState() },
        persistence: await persistence(),
        ignoredRouteNetworks: ignored,
      };
    },

    /**
     * After `load({ base })`: bring the store from the base to the current
     * version (bridge inverses, then the log forward or inverse).
     */
    open: async (feedId: string, baseName: string): Promise<Opened> => {
      if (state) {
        throw new Error('[FeedWorker] a feed is already open in this worker');
      }
      const log = await bindLog(feedId);
      const s = await log.state();
      if (!s) {
        throw new Error(`[FeedWorker] no stored feed ${feedId}`);
      }
      if (s.baseName !== baseName) {
        throw new Error(
          `[FeedWorker] loaded base ${baseName}, but the stored feed points at ${s.baseName}`
        );
      }
      const t0 = performance.now();
      const store = ctx.store();
      const bridge = await log.bridge();
      if (bridge.length !== s.bridgeLength) {
        throw new Error(
          `[FeedWorker] bridge has ${bridge.length} patch(es), expected ${s.bridgeLength}`
        );
      }
      applyPatches(store, bridge, 'inverse');
      const { patches, dir } = await path(
        log,
        s.anchorVersion,
        s.currentVersion
      );
      applyPatches(store, patches, dir);
      state = s;
      const replayed = bridge.length + patches.length;
      console.log(
        `[FeedWorker] opened ${feedId} (${baseName}) at version ${s.currentVersion}: ${replayed} patch(es) replayed in ${Math.round(performance.now() - t0)}ms`
      );
      await activate();
      return {
        state: { ...requireState() },
        persistence: await persistence(),
        replayed,
        foldDue: log.persistent && replayed > CONFIG.FEED_FOLD_PATCHES,
      };
    },

    /**
     * Fold the store at the current version into a new base and point the
     * log at it. The log keeps every patch, so undo still reaches below it.
     * Returns the new base name.
     */
    compact: async (): Promise<string> => {
      const s = requireState();
      const log = await getLog();
      if (!log.persistent) {
        throw new Error(
          '[FeedWorker] nothing to compact in a session without storage'
        );
      }
      const t0 = performance.now();
      const store = ctx.store();
      const folded = store.hasEdits() ? store.fold() : store;
      const next: FeedState = counted({
        ...s,
        baseName: newBaseName(),
        anchorVersion: s.currentVersion,
        bridgeLength: 0,
      });
      next.baseBytes = await saveBase(folded, ctx, next.baseName);
      try {
        await commitBase(log, next, false);
      } catch (err) {
        throw quotaAware(err);
      }
      state = next;
      if (folded !== store) {
        ctx.replaceStore(folded);
      }
      await deleteBaseFile(s.baseName).catch((e: unknown) =>
        console.warn('[FeedWorker] could not delete the old base', e)
      );
      console.log(
        `[FeedWorker] compacted into ${next.baseName} at version ${next.currentVersion} in ${Math.round(performance.now() - t0)}ms`
      );
      return next.baseName;
    },

    /**
     * After `load({ base })`, when `open` failed: replay as much of the log
     * as applies, one patch at a time, and stop at the first that fails. The
     * store is then as close to the stored version as the log allows, for a
     * recovery export.
     */
    recover: async (feedId: string, baseName: string): Promise<Recovered> => {
      if (state) {
        throw new Error('[FeedWorker] a feed is already open in this worker');
      }
      const log = await bindLog(feedId);
      const s = await log.state();
      if (!s || s.baseName !== baseName) {
        throw new Error(
          `[FeedWorker] loaded base ${baseName}, but the stored feed points at ${s?.baseName ?? 'nothing'}`
        );
      }
      const store = ctx.store();
      state = s;
      let applied = 0;
      const total =
        s.bridgeLength + Math.abs(s.currentVersion - s.anchorVersion);
      try {
        const bridge = await log.bridge();
        applyPatches(store, bridge, 'inverse');
        applied += bridge.length;
        const { patches, dir } = await path(
          log,
          s.anchorVersion,
          s.currentVersion
        );
        for (const patch of patches) {
          applyPatch(store, patch, dir);
          applied++;
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        console.error(
          `[FeedWorker] recovery stopped after ${applied} of ${total} patch(es)`,
          err
        );
        return { applied, total, error };
      }
      console.log(`[FeedWorker] recovered all ${applied} patch(es)`);
      return { applied, total };
    },

    state: (): FeedState => ({ ...requireState() }),
    versions,
    edit,

    undo: async (): Promise<Moved | null> => {
      const s = requireState();
      if (s.currentVersion === 0) {
        return null;
      }
      const [rec] = await (
        await getLog()
      ).patches(s.currentVersion, s.currentVersion);
      return move([rec.patch], 'inverse', {
        ...s,
        currentVersion: s.currentVersion - 1,
      });
    },

    redo: async (): Promise<Moved | null> => {
      const s = requireState();
      if (s.currentVersion === s.headVersion) {
        return null;
      }
      const v = s.currentVersion + 1;
      const [rec] = await (await getLog()).patches(v, v);
      return move([rec.patch], 'forward', { ...s, currentVersion: v });
    },

    jumpTo: async (version: number): Promise<Moved> => {
      const s = requireState();
      if (
        !Number.isInteger(version) ||
        version < 0 ||
        version > s.headVersion
      ) {
        throw new Error(
          `[FeedWorker] no version ${version} (head ${s.headVersion})`
        );
      }
      const { patches, dir } = await path(
        await getLog(),
        s.currentVersion,
        version
      );
      return move(patches, dir, { ...s, currentVersion: version });
    },

    history: async (): Promise<(FeedPatchRecord & { applied: boolean })[]> => {
      const s = requireState();
      const recs = await (await getLog()).patches(1, s.headVersion);
      return recs.map((r) => ({
        ...r,
        applied: r.version <= s.currentVersion,
      }));
    },

    setNetworksMode: async (mode: NetworksMode): Promise<void> => {
      const next = { ...requireState(), networksMode: mode };
      await (await getLog()).saveState(next);
      state = next;
    },

    setExtensionColumns: async (
      columns: Record<string, string[]>
    ): Promise<void> => {
      const next = { ...requireState(), extensionColumns: columns };
      await (await getLog()).saveState(next);
      state = next;
    },

    /** Rows of `table` whose columns satisfy every condition (copies). */
    where: (table: string, conds: Cond[]): Row[] =>
      where(ctx.store(), table, conds),

    /** The rows the primary key strings name, null where none (copies). */
    byKeys: (table: string, keys: string[]): (Row | null)[] =>
      keys.map((key) => rowByKey(ctx.store(), table, key)),

    /** Every route's stop_times references, by kind. */
    routeRefs: (): Record<string, RouteRefs> => routeRefs(ctx.store()),

    /** calendar_dates date bounds per service_id. */
    exceptionBounds: (): Record<string, ExceptionBounds> =>
      exceptionBounds(ctx.store()),

    /** Point and trip counts of every shape. */
    shapeSummary: (): Record<string, ShapeSummary> => shapeSummary(ctx.store()),

    /** Timetables and endpoints of the named shapes. */
    shapeDetails: (ids: string[]): Record<string, ShapeDetail> =>
      shapeDetails(ctx.store(), ids),

    /** Re-index the map's route lines; returns each route's bounds. */
    mapRoutes: (): MapRoutesBuilt => mapTiles.buildRoutes(ctx.store()),

    /** Re-index the map's stops. */
    mapStops: (): { stops: number } => mapTiles.buildStops(ctx.store()),

    /** One map tile as MVT bytes, or null when the tile is empty. */
    mapTile: (
      layer: MapTileLayer,
      z: number,
      x: number,
      y: number
    ): Uint8Array | null => mapTiles.tile(layer, z, x, y),

    /** Row count per value of `col`, e.g. trips per route_id. */
    countBy: (table: string, col: string): Record<string, number> => {
      const out: Record<string, number> = {};
      const store = ctx.store();
      if (store.hasTable(table)) {
        store.scan(table, [col], ([v]) => {
          out[v] = (out[v] ?? 0) + 1;
        });
      }
      return out;
    },

    /** Row count per value of `a`, then per value of `b`, e.g. trips per route and service. */
    countBy2: (
      table: string,
      a: string,
      b: string
    ): Record<string, Record<string, number>> => {
      const out: Record<string, Record<string, number>> = {};
      const store = ctx.store();
      if (store.hasTable(table)) {
        store.scan(table, [a, b], ([va, vb]) => {
          const inner = (out[va] ??= {});
          inner[vb] = (inner[vb] ?? 0) + 1;
        });
      }
      return out;
    },

    /** The first `limit` rows of any table (copies). */
    head: (table: string, limit: number): Row[] =>
      head(ctx.store(), table, limit),

    /** Distinct non-empty values of one column. */
    distinct: (table: string, col: string): string[] =>
      distinct(ctx.store(), table, col),

    /** A non-table entry as text, or null when the feed has none. */
    fileText: (name: string): string | null => decode(ctx.store().file(name)),

    /** Non-empty lines of a non-table entry, or null when the feed has none. */
    fileLines: (name: string): number | null => {
      const bytes = ctx.store().file(name);
      return bytes === null ? null : countLines(bytes);
    },

    /**
     * A non-table entry parsed as CSV, its first `limit` rows only, or null
     * when the feed has none. The entry itself is left as it is.
     */
    fileTable: (name: string, limit: number): FileTable | null => {
      const bytes = ctx.store().file(name);
      if (bytes === null) {
        return null;
      }
      const parsed = Papa.parse<string[]>(new TextDecoder().decode(bytes), {
        preview: limit + 1,
        skipEmptyLines: 'greedy',
      });
      if (parsed.errors.length > 0) {
        console.warn(
          `[FeedWorker] ${name}: ${parsed.errors.length} CSV errors, first: ${parsed.errors[0].message}`
        );
      }
      const [first = [], ...rows] = parsed.data;
      const header = first.map((h, i) =>
        (i === 0 ? h.replace(/^\uFEFF/, '') : h).trim()
      );
      return { header, rows, total: Math.max(0, countLines(bytes) - 1) };
    },

    /**
     * Run the feed validation for one short step. Call until `done`; other
     * calls run between steps, and a store change restarts the sweep.
     */
    validateStep: (): ValidateStep =>
      validator.step(ctx.store(), revision, requireState().extensionColumns),

    /**
     * Run the zip export for one short step. Call until `done`; other calls
     * run between steps, and a store change restarts the export.
     */
    exportStep: (): ExportStep =>
      exporter.step(ctx.store(), revision, requireState().networksMode),

    /** Drop a running export. */
    exportCancel: (): void => exporter.cancel(),

    /** Replace (or with null remove) a non-table entry, as a patch. */
    editFile: async (name: string, text: string | null): Promise<Versions> => {
      const before = decode(ctx.store().file(name));
      if (before === text) {
        return versions();
      }
      return edit({ op: 'file', name, before, after: text });
    },
  };
}

export type FeedWorkerApi = ReturnType<typeof feedWorkerApi>;
