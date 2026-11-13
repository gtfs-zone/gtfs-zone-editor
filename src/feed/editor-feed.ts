/**
 * The main thread's view of the open feed, over the editor feed worker.
 *
 * - Mirrored tables are read synchronously. Their rows are frozen: a change
 *   replaces a row object instead of mutating it, so a row held across an
 *   edit keeps its old values.
 * - Everything else (trips, stop_times, shapes, ...) is read with `read`.
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
import type { FeedPatch, FeedPatchRecord, PatchRename } from '../types/patch';
import { generateCompositeKeyFromRecord } from '../utils/gtfs-primary-keys';
import { WORKER_ONLY_TABLES, type FeedClient } from './feed-boot';
import type { FeedState, NetworksMode } from './feed-log';
import type { Moved, Persistence, Versions } from './feed-worker-api';
import { patchTargets } from './patch-build';

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
  /** The patch, for `change`. */
  patch?: FeedPatch;
}

const NO_VERSIONS: Versions = {
  current: 0,
  head: 0,
  canUndo: false,
  canRedo: false,
};

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

  get networksMode(): NetworksMode {
    return this.requireState().networksMode;
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
  adopt(client: FeedClient, state: FeedState, persistence: Persistence): void {
    if (this.client) {
      throw new Error('[EditorFeed] release the open feed before adopting');
    }
    this.client = client;
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
    this.dropCaches();
    console.log('[EditorFeed] released');
  }

  // ===== Mirrored tables =====

  /** True for every table but the worker-only ones, present or not. */
  isMirrored(table: string): boolean {
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

  /** Subscribe to edits and history moves. No unsubscribe, as above. */
  onEdit(listener: (e: FeedEditEvent) => void): void {
    this.editListeners.add(listener);
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
    const versions = await client.call('edit', patch);
    if (this.client !== client) {
      return;
    }
    this.currentVersions = versions;
    if (patch.op === 'batch' && patch.rename) {
      this.followRenames([{ ...patch.rename }]);
    }
    this.emitEdit({ kind: 'change', versions, ...patchTargets(patch), patch });
  }

  /** Replace (or with null remove) a non-table entry, as one undo step. */
  async editFile(name: string, text: string | null): Promise<void> {
    const client = this.requireClient();
    const before = this.currentVersions.current;
    const versions = await client.call('editFile', name, text);
    if (this.client !== client || versions.current === before) {
      return;
    }
    this.currentVersions = versions;
    this.emitEdit({ kind: 'change', versions, tables: [], files: [name] });
  }

  async undo(): Promise<void> {
    const client = this.requireClient();
    this.applyMove(client, 'undo', await client.call('undo'));
  }

  async redo(): Promise<void> {
    const client = this.requireClient();
    this.applyMove(client, 'redo', await client.call('redo'));
  }

  async jumpTo(version: number): Promise<void> {
    const client = this.requireClient();
    this.applyMove(client, 'jump', await client.call('jumpTo', version));
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

  private applyMove(
    client: FeedClient,
    kind: 'undo' | 'redo' | 'jump',
    moved: Moved | null
  ): void {
    if (!moved || this.client !== client) {
      return;
    }
    this.currentVersions = moved.versions;
    this.followRenames(moved.renames);
    this.emitEdit({
      kind,
      versions: moved.versions,
      tables: moved.tables,
      files: moved.files,
    });
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
