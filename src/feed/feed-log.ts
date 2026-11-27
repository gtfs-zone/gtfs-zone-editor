/**
 * The stored feeds: one patch log per feed, its pointer to its base file,
 * and which feed is active.
 *
 * Stored state: the base file (OPFS) holds the feed at `anchorVersion`
 * once the bridge is applied to it. The bridge holds patches whose inverse,
 * in order, takes the base down to `anchorVersion`: an edit made after
 * undoing below the base's version discards the patches the base already
 * contains, so they move to the bridge instead of disappearing. From the
 * anchor, the log's patches lead to `currentVersion`, forward or inverse.
 *
 * `FeedDb` is the IndexedDB connection and the library-wide operations
 * (list, delete, the active pointer). `IdbFeedLog` is one feed's log in it,
 * with every request under a deadline; `MemoryFeedLog` keeps the same state
 * for a session without storage.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { CONFIG } from '../config';
import { withDeadline } from '../utils/idb-request';
import type { FeedPatch, FeedPatchRecord } from '../types/patch';

export type NetworksMode = 'inline' | 'files';

export interface FeedState {
  /** Stable for the feed's life; keys its patches and bridge. */
  id: string;
  /** OPFS base file name; '' in session mode. */
  baseName: string;
  /** Size of the base file in bytes; 0 in session mode. */
  baseBytes: number;
  label: string;
  /** The version the base plus the bridge represents. */
  anchorVersion: number;
  currentVersion: number;
  headVersion: number;
  /** Bridge entries (patches to apply inverse, in order). */
  bridgeLength: number;
  networksMode: NetworksMode;
  extensionColumns: Record<string, string[]>;
  importedAt: number;
  /** feed_info.feed_version as imported; null without feed_info. */
  importFeedVersion: string | null;
  /** Epoch ms of the last import or open. */
  lastOpened: number;
  /** The schedule URL it was imported from, unproxied; null for a file. */
  sourceUrl: string | null;
  /** The download's Last-Modified as YYYY-MM-DD; null when not sent. */
  sourceModified: string | null;
  /** Row counts for the library, as of the last state write. */
  counts: { routes: number; stops: number; trips: number };
}

/** True when the feed has edits, including ones since undone. */
export function hasEdits(state: FeedState): boolean {
  return state.headVersion > 0 || state.bridgeLength > 0;
}

/** One feed's log. */
export interface FeedLog {
  readonly persistent: boolean;
  readonly feedId: string;
  /** The feed's stored state, or null when it is not stored. */
  state(): Promise<FeedState | null>;
  /** Patches with from <= version <= to, ascending. */
  patches(from: number, to: number): Promise<FeedPatchRecord[]>;
  /** Bridge patches, in the order their inverses apply. */
  bridge(): Promise<FeedPatch[]>;
  /**
   * Append `patch` as version current + 1. A redo branch above the current
   * version is discarded first; when that reaches below the anchor, the
   * discarded patches up to the anchor move to the bridge.
   */
  append(state: FeedState, patch: FeedPatch): Promise<FeedState>;
  /** Save version pointers or meta, nothing else. */
  saveState(state: FeedState): Promise<void>;
  /**
   * Point at a new base that holds the feed at `state.currentVersion`:
   * the bridge is emptied, and with `clearPatches` the log too (an import).
   */
  commitBase(state: FeedState, clearPatches: boolean): Promise<void>;
  /**
   * Make this feed the active one, stamping `lastOpened`, and delete every
   * other unedited feed. Returns the new state and the deleted feeds'
   * base names, for the caller to remove.
   */
  activate(state: FeedState): Promise<{ state: FeedState; evicted: string[] }>;
}

const ACTIVE_KEY = 'active';
/** Meta key holding the app version that last opened the database. */
const WRITTEN_BY_KEY = 'written-by';

interface StoredPatch extends FeedPatchRecord {
  feedId: string;
}

interface FeedDB extends DBSchema {
  feeds: { key: string; value: FeedState };
  meta: { key: string; value: { key: string; id?: string; version?: string } };
  patches: { key: [string, number]; value: StoredPatch };
  bridge: {
    key: [string, number];
    value: { feedId: string; seq: number; patch: FeedPatch };
  };
}

const DB_VERSION = 2;

/**
 * The stored database is in a format this build does not open: `older` was
 * written by an earlier build (`writtenBy` when it stamped its version),
 * `newer` by a later one. The stored data is left untouched.
 */
export class StoredFormatError extends Error {
  constructor(
    readonly kind: 'older' | 'newer',
    readonly writtenBy: string | null
  ) {
    super(
      `[FeedLog] stored database is ${kind} than this build` +
        (writtenBy ? ` (written by ${writtenBy})` : '')
    );
    this.name = 'StoredFormatError';
  }
}

/** Every key of one feed in `patches` or `bridge`. */
function feedRange(id: string): IDBKeyRange {
  return IDBKeyRange.bound([id, -Infinity], [id, Infinity]);
}

export function newFeedId(): string {
  const rand = Math.floor(Math.random() * 1e9).toString(36);
  return `feed-${Date.now().toString(36)}-${rand}`;
}

/**
 * Run a write transaction under a deadline. On timeout the transaction is
 * aborted, so a write the caller reports as failed never lands later.
 */
async function runTx(
  tx: { done: Promise<void>; abort(): void },
  work: Promise<void>,
  what: string
): Promise<void> {
  // Failures surface through `work`; this only marks `done` as handled.
  tx.done.catch(() => {});
  try {
    await withDeadline(work, what);
  } catch (err) {
    try {
      tx.abort();
    } catch {
      // Already finished: it committed if `done` resolves.
      await tx.done;
      return;
    }
    throw err;
  }
}

/** The new state after appending at current + 1, before any write. */
function appended(state: FeedState): FeedState {
  const version = state.currentVersion + 1;
  return { ...state, currentVersion: version, headVersion: version };
}

/** The feed database connection and the library-wide operations. */
export class FeedDb {
  private db: IDBPDatabase<FeedDB> | null = null;

  async open(): Promise<IDBPDatabase<FeedDB>> {
    if (this.db) {
      return this.db;
    }
    // Set when the upgrade finds an older database and aborts.
    let older: { writtenBy: string | null } | null = null;
    const opening = withDeadline(
      openDB<FeedDB>(CONFIG.FEED_DB_NAME, DB_VERSION, {
        upgrade(db, oldVersion, _newVersion, tx) {
          if (oldVersion > 0) {
            // Abort instead of replacing the stores: the data stays for the
            // build that wrote it to export.
            console.warn(
              `[FeedLog] stored database is v${oldVersion}, this build is v${DB_VERSION}: not upgrading`
            );
            if (!db.objectStoreNames.contains('meta')) {
              older = { writtenBy: null };
              tx.abort();
              return;
            }
            void tx
              .objectStore('meta')
              .get(WRITTEN_BY_KEY)
              .then(
                (rec) => {
                  older = { writtenBy: rec?.version ?? null };
                  tx.abort();
                },
                () => {
                  older = { writtenBy: null };
                  tx.abort();
                }
              );
            return;
          }
          console.log('[FeedLog] creating schema');
          db.createObjectStore('feeds', { keyPath: 'id' });
          db.createObjectStore('meta', { keyPath: 'key' });
          db.createObjectStore('patches', { keyPath: ['feedId', 'version'] });
          db.createObjectStore('bridge', { keyPath: ['feedId', 'seq'] });
        },
        blocked() {
          console.warn('[FeedLog] open blocked by an older connection');
        },
        // Another tab upgrading or deleting the database: let it through.
        blocking: () => {
          console.warn('[FeedLog] closing for another tab');
          this.close();
        },
        terminated: () => {
          console.warn('[FeedLog] connection terminated by the browser');
          this.db = null;
        },
      }),
      'opening the feed database'
    );
    let db: IDBPDatabase<FeedDB>;
    try {
      db = await opening;
    } catch (err) {
      const found = older as { writtenBy: string | null } | null;
      if (found) {
        throw new StoredFormatError('older', found.writtenBy);
      }
      if (err instanceof DOMException && err.name === 'VersionError') {
        throw new StoredFormatError('newer', null);
      }
      throw err;
    }
    await withDeadline(
      db.put('meta', { key: WRITTEN_BY_KEY, version: __APP_VERSION__ }),
      'stamping the feed database version'
    );
    this.db = db;
    return db;
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  /** Every stored feed, most recently opened first. */
  async list(): Promise<FeedState[]> {
    const db = await this.open();
    const all = await withDeadline(db.getAll('feeds'), 'listing stored feeds');
    return all.sort((a, b) => b.lastOpened - a.lastOpened);
  }

  async get(id: string): Promise<FeedState | null> {
    const db = await this.open();
    return (
      (await withDeadline(db.get('feeds', id), `reading feed ${id}`)) ?? null
    );
  }

  /** The active feed's id, or null when none is set. */
  async activeId(): Promise<string | null> {
    const db = await this.open();
    const rec = await withDeadline(
      db.get('meta', ACTIVE_KEY),
      'reading the active feed'
    );
    return rec?.id ?? null;
  }

  /** The active feed's state, or null when none is stored. */
  async active(): Promise<FeedState | null> {
    const id = await this.activeId();
    return id ? this.get(id) : null;
  }

  /**
   * Delete one feed's state, patches and bridge (not its base file), and
   * clear the active pointer when it named the feed. Returns its base name.
   */
  async delete(id: string): Promise<string | null> {
    const db = await this.open();
    const tx = db.transaction(
      ['feeds', 'meta', 'patches', 'bridge'],
      'readwrite'
    );
    let baseName: string | null = null;
    const work = (async () => {
      const rec = await tx.objectStore('feeds').get(id);
      baseName = rec?.baseName || null;
      await tx.objectStore('feeds').delete(id);
      await tx.objectStore('patches').delete(feedRange(id));
      await tx.objectStore('bridge').delete(feedRange(id));
      const active = await tx.objectStore('meta').get(ACTIVE_KEY);
      if (active?.id === id) {
        await tx.objectStore('meta').delete(ACTIVE_KEY);
      }
      await tx.done;
    })();
    await runTx(tx, work, `deleting feed ${id}`);
    console.log(`[FeedLog] deleted feed ${id}`);
    return baseName;
  }

  /** Base names any stored feed points at. */
  async baseNames(): Promise<string[]> {
    return (await this.list()).map((f) => f.baseName).filter(Boolean);
  }
}

/** One feed's log in the feed database. */
export class IdbFeedLog implements FeedLog {
  readonly persistent = true;

  constructor(
    readonly feedId: string,
    private readonly db: FeedDb = new FeedDb()
  ) {}

  close(): void {
    this.db.close();
  }

  private open(): Promise<IDBPDatabase<FeedDB>> {
    return this.db.open();
  }

  async state(): Promise<FeedState | null> {
    return this.db.get(this.feedId);
  }

  async patches(from: number, to: number): Promise<FeedPatchRecord[]> {
    if (to < from) {
      return [];
    }
    const db = await this.open();
    const recs = await withDeadline(
      db.getAll(
        'patches',
        IDBKeyRange.bound([this.feedId, from], [this.feedId, to])
      ),
      `reading patches ${from}-${to}`
    );
    if (recs.length !== to - from + 1) {
      throw new Error(
        `[FeedLog] patches ${from}-${to}: found ${recs.length}, the log has gaps`
      );
    }
    return recs.map(({ version, patch, timestamp }) => ({
      version,
      patch,
      timestamp,
    }));
  }

  async bridge(): Promise<FeedPatch[]> {
    const db = await this.open();
    const out = await withDeadline(
      db.getAll('bridge', feedRange(this.feedId)),
      'reading the bridge'
    );
    return out.map((e) => e.patch);
  }

  async append(state: FeedState, patch: FeedPatch): Promise<FeedState> {
    const db = await this.open();
    const id = this.feedId;
    const tx = db.transaction(['feeds', 'patches', 'bridge'], 'readwrite');
    const next = appended(state);
    const work = (async () => {
      const patches = tx.objectStore('patches');
      const cur = state.currentVersion;
      if (cur < state.headVersion) {
        if (cur < state.anchorVersion) {
          const lost = await patches.getAll(
            IDBKeyRange.bound([id, cur + 1], [id, state.anchorVersion])
          );
          const bridge = tx.objectStore('bridge');
          let seq = state.bridgeLength;
          for (const rec of lost.reverse()) {
            await bridge.add({ feedId: id, seq: seq++, patch: rec.patch });
          }
          next.bridgeLength = state.bridgeLength + lost.length;
          next.anchorVersion = cur;
          console.log(
            `[FeedLog] ${lost.length} patch(es) below the anchor moved to the bridge`
          );
        }
        await patches.delete(
          IDBKeyRange.bound([id, cur], [id, Infinity], true)
        );
      }
      await patches.put({
        feedId: id,
        version: next.currentVersion,
        patch,
        timestamp: Date.now(),
      });
      await tx.objectStore('feeds').put(next);
      await tx.done;
    })();
    await runTx(tx, work, `appending patch ${next.currentVersion}`);
    return next;
  }

  async saveState(state: FeedState): Promise<void> {
    const db = await this.open();
    await withDeadline(db.put('feeds', state), 'saving feed state');
  }

  async commitBase(state: FeedState, clearPatches: boolean): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(['feeds', 'patches', 'bridge'], 'readwrite');
    const work = (async () => {
      await tx.objectStore('bridge').delete(feedRange(this.feedId));
      if (clearPatches) {
        await tx.objectStore('patches').delete(feedRange(this.feedId));
      }
      await tx.objectStore('feeds').put(state);
      await tx.done;
    })();
    await runTx(tx, work, `committing base ${state.baseName}`);
  }

  async activate(
    state: FeedState
  ): Promise<{ state: FeedState; evicted: string[] }> {
    const db = await this.open();
    const next = { ...state, lastOpened: Date.now() };
    const tx = db.transaction(
      ['feeds', 'meta', 'patches', 'bridge'],
      'readwrite'
    );
    const evicted: string[] = [];
    const work = (async () => {
      const feeds = tx.objectStore('feeds');
      for (const other of await feeds.getAll()) {
        if (other.id === next.id || hasEdits(other)) {
          continue;
        }
        await feeds.delete(other.id);
        await tx.objectStore('patches').delete(feedRange(other.id));
        await tx.objectStore('bridge').delete(feedRange(other.id));
        if (other.baseName) {
          evicted.push(other.baseName);
        }
        console.log(
          `[FeedLog] evicted unedited feed ${other.id} (${other.label})`
        );
      }
      await feeds.put(next);
      await tx.objectStore('meta').put({ key: ACTIVE_KEY, id: next.id });
      await tx.done;
    })();
    await runTx(tx, work, `activating feed ${next.id}`);
    return { state: next, evicted };
  }
}

/** The same log for a session without storage. Nothing outlives the page. */
export class MemoryFeedLog implements FeedLog {
  readonly persistent = false;

  constructor(readonly feedId: string) {}

  private current: FeedState | null = null;
  private log = new Map<number, FeedPatchRecord>();
  private bridgeList: FeedPatch[] = [];

  async state(): Promise<FeedState | null> {
    return this.current ? { ...this.current } : null;
  }

  async patches(from: number, to: number): Promise<FeedPatchRecord[]> {
    const out: FeedPatchRecord[] = [];
    for (let v = from; v <= to; v++) {
      const rec = this.log.get(v);
      if (!rec) {
        throw new Error(`[FeedLog] no patch ${v}`);
      }
      out.push(rec);
    }
    return out;
  }

  async bridge(): Promise<FeedPatch[]> {
    return [...this.bridgeList];
  }

  async append(state: FeedState, patch: FeedPatch): Promise<FeedState> {
    const next = appended(state);
    const cur = state.currentVersion;
    if (cur < state.anchorVersion) {
      for (let v = state.anchorVersion; v > cur; v--) {
        this.bridgeList.push(this.log.get(v)!.patch);
      }
      next.bridgeLength = this.bridgeList.length;
      next.anchorVersion = cur;
    }
    for (const v of [...this.log.keys()]) {
      if (v > cur) {
        this.log.delete(v);
      }
    }
    this.log.set(next.currentVersion, {
      version: next.currentVersion,
      patch,
      timestamp: Date.now(),
    });
    this.current = { ...next };
    return next;
  }

  async saveState(state: FeedState): Promise<void> {
    this.current = { ...state };
  }

  async commitBase(state: FeedState, clearPatches: boolean): Promise<void> {
    this.bridgeList = [];
    if (clearPatches) {
      this.log.clear();
    }
    this.current = { ...state };
  }

  async activate(
    state: FeedState
  ): Promise<{ state: FeedState; evicted: string[] }> {
    const next = { ...state, lastOpened: Date.now() };
    this.current = { ...next };
    return { state: next, evicted: [] };
  }
}
