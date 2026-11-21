/**
 * The main thread's view of the open feed, over the editor feed worker.
 *
 * - Mirrored tables are read synchronously. Their rows are frozen: a change
 *   replaces a row object instead of mutating it, so a row held across an
 *   edit keeps its old values.
 * - Everything else (trips, stop_times, shapes, ...) is read with `read`.
 * - `MIRRORED_FILES` (non-table entries) are held as text and read with
 *   `file`; other entries are read with `fileText`.
 * - Every edit is a patch sent with `edit`; the worker applies it, logs it
 *   and replies with the mirror changes, which are in place before `edit`
 *   resolves and before `onEdit` listeners run.
 *
 * One feed at a time. `adopt` installs a loaded client (see `feed-loader.ts`)
 * and bumps `feedGeneration`; `release` terminates the worker.
 */

import type {
  MirrorChange,
  Row,
  StoreApi,
} from 'gtfs-zone-web-common/gtfs/store/store-client';
import type {
  FeedPatch,
  FeedPatchRecord,
  FileChange,
  PatchRename,
  SingleGTFSPatch,
} from '../types/patch';
import { generateCompositeKeyFromRecord } from '../utils/gtfs-primary-keys';
import {
  WORKER_ONLY_TABLES,
  exportZip,
  type ExportProgress,
  type FeedClient,
} from './feed-boot';
import type { FeedState, NetworksMode } from './feed-log';
import { QUOTA_MESSAGE } from './quota';
import { notify } from 'gtfs-zone-web-common/ui/notification-system';
import { t } from '../i18n/messages';
import type {
  Cond,
  Moved,
  Persistence,
  RouteRefs,
  ShapeDetail,
  ShapeSummary,
  Versions,
} from './feed-worker-api';
import { batch, patchTargets } from './patch-build';
import type { ValidateStep } from './feed-validate';
import type { MapRoutesBuilt, MapTileLayer } from './map-tiles';

/** Store methods that write: edits go through patches instead. */
type StoreWrites =
  | 'ensureTable'
  | 'insertRow'
  | 'updateRow'
  | 'deleteRow'
  | 'setTripStopTimes'
  | 'setShape'
  | 'setFile'
  | 'saveBase';

type StoreReads = Omit<StoreApi, StoreWrites>;

export type FeedRow = Readonly<Row>;

export interface FeedEditEvent {
  kind: 'change' | 'undo' | 'redo' | 'jump';
  versions: Versions;
  /** Tables and non-table entries the edit or move wrote. */
  tables: string[];
  files: string[];
  /** The patch, for `change`; the moved patch, for `undo` / `redo`. */
  patch?: FeedPatch;
}

/** Non-table entries the main thread holds as text. */
const MIRRORED_FILES: readonly string[] = ['locations.geojson'];

/** Tables are named as in the store (`stops`), never as files (`stops.txt`). */
function assertStoreName(table: string): void {
  if (table.includes('.')) {
    throw new Error(
      `[EditorFeed] ${table} is a file name; pass the table name (specStoreName)`
    );
  }
}

const NO_VERSIONS: Versions = {
  current: 0,
  head: 0,
  canUndo: false,
  canRedo: false,
};

/** Show a sticky error when `err` is the worker's storage-full error. */
function reportIfQuota(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes(QUOTA_MESSAGE)) {
    console.error('[EditorFeed] storage full', err);
    notify.error(t('parse.quotaFull'), { autoHide: false });
  }
}

export class EditorFeed {
  private client: FeedClient | null = null;
  private generation = 0;
  private feedState: FeedState | null = null;
  private feedPersistence: Persistence | null = null;
  private currentVersions: Versions = NO_VERSIONS;

  /** Row arrays per mirrored table, rebuilt after a change to it. */
  private rowsCache = new Map<string, readonly FeedRow[]>();
  /** Primary key -> row id per mirrored table, rebuilt after a change to it. */
  private keyIndex = new Map<string, Map<string, number>>();
  /** Text of each `MIRRORED_FILES` entry the feed has. */
  private files = new Map<string, string>();

  private feedListeners = new Set<() => void>();
  private editListeners = new Set<(e: FeedEditEvent) => void>();
  private mirrorListeners = new Set<(c: MirrorChange | null) => void>();
  private renameFollower: ((rename: PatchRename) => void) | null = null;

  // ===== Lifecycle =====

  /** Bumps each time a different feed is adopted. Feed-scoped memos key on it. */
  get feedGeneration(): number {
    return this.generation;
  }

  get isOpen(): boolean {
    return this.client !== null;
  }

  /** Session mode saves nothing; null when no feed is open. */
  get persistence(): Persistence | null {
    return this.feedPersistence;
  }

  get label(): string {
    return this.feedState?.label ?? '';
  }

  /** The open feed's stored id; null when none is open. */
  get feedId(): string | null {
    return this.feedState?.id ?? null;
  }

  get networksMode(): NetworksMode {
    return this.requireState().networksMode;
  }

  /** feed_info.feed_version as imported; null without feed_info. */
  get importFeedVersion(): string | null {
    return this.requireState().importFeedVersion;
  }

  /** User-added columns not yet filled in, per table. */
  get extensionColumns(): Readonly<Record<string, readonly string[]>> {
    return this.requireState().extensionColumns;
  }

  /**
   * Subscribe to feed swaps. Fires once the new feed is fully in place. No
   * unsubscribe: listeners are the app's long-lived modules.
   */
  onFeedReplaced(listener: () => void): void {
    this.feedListeners.add(listener);
  }

  /**
   * Install a loaded and opened client. The previous one must already be
   * released, so two feeds are never in memory together.
   */
  async adopt(
    client: FeedClient,
    state: FeedState,
    persistence: Persistence
  ): Promise<void> {
    if (this.client) {
      throw new Error('[EditorFeed] release the open feed before adopting');
    }
    let files: Map<string, string>;
    try {
      files = await readFiles(client, MIRRORED_FILES);
    } catch (err) {
      client.release();
      throw err;
    }
    if (this.client) {
      client.release();
      throw new Error('[EditorFeed] another feed was adopted meanwhile');
    }
    this.client = client;
    this.files = files;
    this.feedState = { ...state };
    this.feedPersistence = persistence;
    this.currentVersions = {
      current: state.currentVersion,
      head: state.headVersion,
      canUndo: state.currentVersion > 0,
      canRedo: state.currentVersion < state.headVersion,
    };
    this.dropCaches();
    for (const rows of client.mirror.values()) {
      for (const row of rows.values()) {
        Object.freeze(row);
      }
    }
    client.addEventListener('mirrorchange', (e) => {
      if (this.client !== client) {
        return;
      }
      const change = (e as CustomEvent<MirrorChange>).detail;
      if (change.row) {
        Object.freeze(change.row);
      }
      this.rowsCache.delete(change.table);
      this.keyIndex.delete(change.table);
      this.emitMirror(change);
    });
    client.addEventListener('mirrorreset', () => {
      if (this.client !== client) {
        return;
      }
      for (const rows of client.mirror.values()) {
        for (const row of rows.values()) {
          Object.freeze(row);
        }
      }
      this.dropCaches();
      this.emitMirror(null);
    });
    this.generation++;
    console.log(
      `[EditorFeed] adopted ${state.label || '(unnamed)'} at version ${state.currentVersion} (generation ${this.generation}, ${persistence})`
    );
    for (const listener of this.feedListeners) {
      try {
        listener();
      } catch (err) {
        console.error('[EditorFeed] feed-replaced listener threw:', err);
      }
    }
  }

  /** Terminate the worker. Pending calls reject. */
  release(): void {
    if (!this.client) {
      return;
    }
    this.client.release();
    this.client = null;
    this.feedState = null;
    this.feedPersistence = null;
    this.currentVersions = NO_VERSIONS;
    this.files = new Map();
    this.dropCaches();
    console.log('[EditorFeed] released');
  }

  // ===== Mirrored tables =====

  /** True for every table but the worker-only ones, present or not. */
  isMirrored(table: string): boolean {
    assertStoreName(table);
    return !WORKER_ONLY_TABLES.includes(table);
  }

  /** Mirrored tables the feed has (tables created by edits included). */
  mirroredTables(): string[] {
    return [...this.requireClient().mirror.keys()];
  }

  /**
   * A mirrored table's rows, in file order with inserts last. Empty for a
   * table the feed does not have. Throws for a worker-only table.
   */
  table(table: string): readonly FeedRow[] {
    this.assertMirrorable(table);
    let rows = this.rowsCache.get(table);
    if (!rows) {
      rows = [...(this.requireClient().mirror.get(table)?.values() ?? [])];
      this.rowsCache.set(table, rows);
    }
    return rows;
  }

  /** A mirrored row by its primary key string, or null. */
  byKey(table: string, key: string): FeedRow | null {
    this.assertMirrorable(table);
    const id = this.keysOf(table).get(key);
    return id === undefined
      ? null
      : (this.requireClient().mirror.get(table)?.get(id) ?? null);
  }

  /** `change` is null after a whole-mirror reset. */
  onMirrorChange(listener: (change: MirrorChange | null) => void): void {
    this.mirrorListeners.add(listener);
  }

  // ===== Async reads =====

  /** Run a store read in the worker. */
  read<K extends keyof StoreReads & string>(
    method: K,
    ...args: Parameters<StoreReads[K]>
  ): Promise<Awaited<ReturnType<StoreReads[K]>>> {
    return this.requireClient().call(method, ...args) as Promise<
      Awaited<ReturnType<StoreReads[K]>>
    >;
  }

  /**
   * Rows of any table whose `col` equals `value`: filtered from the mirror,
   * or found in the worker for a worker-only table (copies).
   */
  async find(table: string, col: string, value: string): Promise<FeedRow[]> {
    if (this.isMirrored(table)) {
      return this.table(table).filter((r) => (r[col] ?? '') === value);
    }
    return this.where(table, [{ col, eq: value }]);
  }

  /**
   * Rows of any table satisfying every condition (see `Cond`), filtered from
   * the mirror or in the worker.
   */
  async where(table: string, conds: Cond[]): Promise<FeedRow[]> {
    if (!this.isMirrored(table)) {
      return this.requireClient().call('where', table, conds);
    }
    const sets = conds.map((c) => (c.in ? new Set(c.in) : null));
    return this.table(table).filter((r) =>
      conds.every((c, i) => {
        const v = r[c.col] ?? '';
        return (
          (c.eq === undefined || v === c.eq) &&
          (sets[i] === null || sets[i].has(v)) &&
          (c.lt === undefined || v < c.lt) &&
          (c.gt === undefined || v > c.gt)
        );
      })
    );
  }

  /**
   * Row count per value of `col` in any ordinary table (not stop_times or
   * shapes), e.g. trips per route_id.
   */
  async countBy(table: string, col: string): Promise<Record<string, number>> {
    if (!this.isMirrored(table)) {
      return this.requireClient().call('countBy', table, col);
    }
    const out: Record<string, number> = {};
    for (const r of this.table(table)) {
      const v = r[col] ?? '';
      out[v] = (out[v] ?? 0) + 1;
    }
    return out;
  }

  /**
   * Row count per value of `a`, then per value of `b`, in any ordinary table
   * (e.g. trips per route_id and service_id).
   */
  async countBy2(
    table: string,
    a: string,
    b: string
  ): Promise<Record<string, Record<string, number>>> {
    if (!this.isMirrored(table)) {
      return this.requireClient().call('countBy2', table, a, b);
    }
    const out: Record<string, Record<string, number>> = {};
    for (const r of this.table(table)) {
      const inner = (out[r[a] ?? ''] ??= {});
      inner[r[b] ?? ''] = (inner[r[b] ?? ''] ?? 0) + 1;
    }
    return out;
  }

  /** Point and trip counts of every shape (built in the worker). */
  shapeSummary(): Promise<Record<string, ShapeSummary>> {
    return this.requireClient().call('shapeSummary');
  }

  /** Timetables and endpoints of the named shapes (built in the worker). */
  shapeDetails(ids: string[]): Promise<Record<string, ShapeDetail>> {
    return this.requireClient().call('shapeDetails', ids);
  }

  /** Re-index the map's route lines in the worker; each route's bounds. */
  mapRoutes(): Promise<MapRoutesBuilt> {
    return this.requireClient().call('mapRoutes');
  }

  /** Re-index the map's stops in the worker. */
  mapStops(): Promise<{ stops: number }> {
    return this.requireClient().call('mapStops');
  }

  /** One map tile as MVT bytes, or null when empty (see `mapRoutes`). */
  mapTile(
    layer: MapTileLayer,
    z: number,
    x: number,
    y: number
  ): Promise<Uint8Array | null> {
    return this.requireClient().call('mapTile', layer, z, x, y);
  }

  /** The whole feed as a GTFS zip, built in the worker (see `exportZip`). */
  exportZip(
    hooks: {
      onProgress?: (p: ExportProgress) => void;
      signal?: AbortSignal;
    } = {}
  ): Promise<Blob> {
    return exportZip(this.requireClient(), hooks);
  }

  /** One step of the feed validation in the worker (see `validateStep`). */
  validateStep(): Promise<ValidateStep> {
    return this.requireClient().call('validateStep');
  }

  /** Every route's stop_times references, by kind (built in the worker). */
  routeRefs(): Promise<Record<string, RouteRefs>> {
    return this.requireClient().call('routeRefs');
  }

  /** Rows of any table by primary key string, null where none. */
  async byKeys(table: string, keys: string[]): Promise<(FeedRow | null)[]> {
    if (this.isMirrored(table)) {
      return keys.map((key) => this.byKey(table, key));
    }
    return this.requireClient().call('byKeys', table, keys);
  }

  /** The first `limit` rows of any table, in table order. */
  async head(table: string, limit: number): Promise<FeedRow[]> {
    if (this.isMirrored(table)) {
      return this.table(table).slice(0, limit);
    }
    return this.requireClient().call('head', table, limit);
  }

  /** Distinct non-empty values of one column of any table. */
  async distinct(table: string, col: string): Promise<string[]> {
    if (!this.isMirrored(table)) {
      return this.requireClient().call('distinct', table, col);
    }
    const out = new Set<string>();
    for (const r of this.table(table)) {
      const v = r[col] ?? '';
      if (v !== '') {
        out.add(v);
      }
    }
    return [...out];
  }

  /** The first row `find` gives, or null. */
  async findOne(
    table: string,
    col: string,
    value: string
  ): Promise<FeedRow | null> {
    return (await this.find(table, col, value))[0] ?? null;
  }

  /** A `MIRRORED_FILES` entry as text, or null when the feed has none. */
  file(name: string): string | null {
    if (!MIRRORED_FILES.includes(name)) {
      throw new Error(`[EditorFeed] ${name} is not mirrored; use fileText()`);
    }
    this.requireClient();
    return this.files.get(name) ?? null;
  }

  /** Names of the feed's non-table entries. */
  fileNames(): Promise<string[]> {
    return this.requireClient().call('fileNames');
  }

  /** A non-table entry (e.g. `locations.geojson`) as text, or null. */
  fileText(name: string): Promise<string | null> {
    return this.requireClient().call('fileText', name);
  }

  history(): Promise<(FeedPatchRecord & { applied: boolean })[]> {
    return this.requireClient().call('history');
  }

  // ===== Edits and history =====

  get versions(): Versions {
    return this.currentVersions;
  }

  get canUndo(): boolean {
    return this.currentVersions.canUndo;
  }

  get canRedo(): boolean {
    return this.currentVersions.canRedo;
  }

  get version(): number {
    return this.currentVersions.current;
  }

  /** Subscribe to edits and history moves. Returns the unsubscribe. */
  onEdit(listener: (e: FeedEditEvent) => void): () => void {
    this.editListeners.add(listener);
    return () => this.editListeners.delete(listener);
  }

  /**
   * What re-points the UI when a patch renames an ID. Runs after the mirror
   * holds the new rows and before `onEdit` listeners, so they render against
   * the new ID.
   */
  setRenameFollower(fn: (rename: PatchRename) => void): void {
    this.renameFollower = fn;
  }

  /** Apply and log one patch (one undo step). */
  async edit(patch: FeedPatch): Promise<void> {
    const client = this.requireClient();
    const versions = await client.call('edit', patch).catch((err: unknown) => {
      reportIfQuota(err);
      throw err;
    });
    const targets = patchTargets(patch);
    await this.refreshFiles(client, targets.files);
    if (this.client !== client) {
      return;
    }
    this.currentVersions = versions;
    if (patch.op === 'batch' && patch.rename) {
      this.followRenames([{ ...patch.rename }]);
    }
    this.emitEdit({ kind: 'change', versions, ...targets, patch });
  }

  /**
   * Apply ops as one undo step (see `batch`). Nothing happens when every op
   * is null. Returns whether a patch was applied.
   */
  async apply(
    ops: (SingleGTFSPatch | null)[],
    label?: string,
    rename?: PatchRename,
    files?: FileChange[]
  ): Promise<boolean> {
    const patch = batch(ops, label, rename, files);
    if (!patch) {
      return false;
    }
    await this.edit(patch);
    return true;
  }

  /** Replace (or with null remove) a non-table entry, as one undo step. */
  async editFile(name: string, text: string | null): Promise<void> {
    const client = this.requireClient();
    const before = this.currentVersions.current;
    const versions = await client
      .call('editFile', name, text)
      .catch((err: unknown) => {
        reportIfQuota(err);
        throw err;
      });
    if (this.client !== client || versions.current === before) {
      return;
    }
    if (MIRRORED_FILES.includes(name)) {
      this.setFile(name, text);
    }
    this.currentVersions = versions;
    this.emitEdit({ kind: 'change', versions, tables: [], files: [name] });
  }

  async undo(): Promise<void> {
    const client = this.requireClient();
    await this.applyMove(client, 'undo', await client.call('undo'));
  }

  async redo(): Promise<void> {
    const client = this.requireClient();
    await this.applyMove(client, 'redo', await client.call('redo'));
  }

  async jumpTo(version: number): Promise<void> {
    const client = this.requireClient();
    await this.applyMove(client, 'jump', await client.call('jumpTo', version));
  }

  async setNetworksMode(mode: NetworksMode): Promise<void> {
    const client = this.requireClient();
    await client.call('setNetworksMode', mode);
    if (this.client === client) {
      this.requireState().networksMode = mode;
    }
  }

  async setExtensionColumns(columns: Record<string, string[]>): Promise<void> {
    const client = this.requireClient();
    await client.call('setExtensionColumns', columns);
    if (this.client === client) {
      this.requireState().extensionColumns = structuredClone(columns);
    }
  }

  // ===== Internals =====

  private async applyMove(
    client: FeedClient,
    kind: 'undo' | 'redo' | 'jump',
    moved: Moved | null
  ): Promise<void> {
    if (!moved || this.client !== client) {
      return;
    }
    await this.refreshFiles(client, moved.files);
    if (this.client !== client) {
      return;
    }
    this.currentVersions = moved.versions;
    this.followRenames(moved.renames);
    this.emitEdit({
      kind,
      versions: moved.versions,
      tables: moved.tables,
      files: moved.files,
      ...(moved.patch && { patch: moved.patch }),
    });
  }

  /** Re-read the mirrored entries among `names` from the worker. */
  private async refreshFiles(
    client: FeedClient,
    names: string[]
  ): Promise<void> {
    const wanted = names.filter((n) => MIRRORED_FILES.includes(n));
    if (wanted.length === 0) {
      return;
    }
    const fresh = await readFiles(client, wanted);
    if (this.client !== client) {
      return;
    }
    for (const name of wanted) {
      this.setFile(name, fresh.get(name) ?? null);
    }
  }

  private setFile(name: string, text: string | null): void {
    if (text === null) {
      this.files.delete(name);
    } else {
      this.files.set(name, text);
    }
  }

  private followRenames(renames: PatchRename[]): void {
    if (!this.renameFollower) {
      return;
    }
    for (const r of renames) {
      this.renameFollower(r);
    }
  }

  private emitEdit(e: FeedEditEvent): void {
    console.log(
      `[EditorFeed] ${e.kind} -> version ${e.versions.current} (${[...e.tables, ...e.files].join(', ') || 'nothing'})`
    );
    for (const listener of this.editListeners) {
      try {
        listener(e);
      } catch (err) {
        console.error('[EditorFeed] edit listener threw:', err);
      }
    }
  }

  private emitMirror(change: MirrorChange | null): void {
    for (const listener of this.mirrorListeners) {
      try {
        listener(change);
      } catch (err) {
        console.error('[EditorFeed] mirror listener threw:', err);
      }
    }
  }

  private keysOf(table: string): Map<string, number> {
    let index = this.keyIndex.get(table);
    if (index) {
      return index;
    }
    index = new Map();
    let missing = 0;
    for (const [id, row] of this.requireClient().mirror.get(table) ?? []) {
      let key: string;
      try {
        key = generateCompositeKeyFromRecord(table, row);
      } catch {
        missing++;
        continue;
      }
      if (index.has(key)) {
        console.warn(
          `[EditorFeed] ${table} has more than one row keyed ${key}`
        );
      }
      index.set(key, id);
    }
    if (missing > 0) {
      console.warn(
        `[EditorFeed] ${missing} ${table} row(s) have no primary key value and cannot be looked up by key`
      );
    }
    this.keyIndex.set(table, index);
    return index;
  }

  private assertMirrorable(table: string): void {
    assertStoreName(table);
    if (WORKER_ONLY_TABLES.includes(table)) {
      throw new Error(`[EditorFeed] ${table} is not mirrored; use read()`);
    }
  }

  private dropCaches(): void {
    this.rowsCache.clear();
    this.keyIndex.clear();
  }

  private requireClient(): FeedClient {
    if (!this.client) {
      throw new Error('[EditorFeed] no feed is open');
    }
    return this.client;
  }

  private requireState(): FeedState {
    if (!this.feedState) {
      throw new Error('[EditorFeed] no feed is open');
    }
    return this.feedState;
  }
}

/** The text of each of `names` the feed has. */
async function readFiles(
  client: FeedClient,
  names: readonly string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const name of names) {
    const text = await client.call('fileText', name);
    if (text !== null) {
      out.set(name, text);
    }
  }
  return out;
}
