/**
 * The feed's patch log and its pointer to the active base file.
 *
 * Stored state: the base file (OPFS) holds the feed at `anchorVersion`
 * once the bridge is applied to it. The bridge holds patches whose inverse,
 * in order, takes the base down to `anchorVersion`: an edit made after
 * undoing below the base's version discards the patches the base already
 * contains, so they move to the bridge instead of disappearing. From the
 * anchor, the log's patches lead to `currentVersion`, forward or inverse.
 *
 * `IdbFeedLog` persists to IndexedDB with every request under a deadline;
 * `MemoryFeedLog` keeps the same state for a session without storage.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { CONFIG } from '../config';
import { withDeadline } from '../utils/idb-request';
import type { FeedPatch, FeedPatchRecord } from '../types/patch';

export type NetworksMode = 'inline' | 'files';

export interface FeedState {
  /** OPFS base file name; '' in session mode. */
  baseName: string;
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
  /** Row counts for the continue card, as of the last state write. */
  counts: { routes: number; stops: number; trips: number };
}

export interface FeedLog {
  readonly persistent: boolean;
  /** The stored state, or null when no feed is stored. */
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
}

const STATE_KEY = 'feed';

interface FeedDB extends DBSchema {
  meta: { key: string; value: FeedState & { key: string } };
  patches: { key: number; value: FeedPatchRecord };
  bridge: { key: number; value: { patch: FeedPatch } };
}

const DB_VERSION = 1;

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

export class IdbFeedLog implements FeedLog {
  readonly persistent = true;
  private db: IDBPDatabase<FeedDB> | null = null;

  private async open(): Promise<IDBPDatabase<FeedDB>> {
    if (this.db) {
      return this.db;
    }
    const db = await withDeadline(
      openDB<FeedDB>(CONFIG.FEED_DB_NAME, DB_VERSION, {
        upgrade(db, oldVersion) {
          console.log(`[FeedLog] creating schema (was v${oldVersion})`);
          for (const name of Array.from(db.objectStoreNames)) {
            db.deleteObjectStore(name);
          }
          db.createObjectStore('meta', { keyPath: 'key' });
          db.createObjectStore('patches', { keyPath: 'version' });
          db.createObjectStore('bridge', { autoIncrement: true });
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
    this.db = db;
    return db;
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  async state(): Promise<FeedState | null> {
    const db = await this.open();
    const rec = await withDeadline(
      db.get('meta', STATE_KEY),
      'reading feed state'
    );
    if (!rec) {
      return null;
    }
    const state: Partial<typeof rec> = { ...rec };
    delete state.key;
    return state as FeedState;
  }

  async patches(from: number, to: number): Promise<FeedPatchRecord[]> {
    if (to < from) {
      return [];
    }
    const db = await this.open();
    const out = await withDeadline(
      db.getAll('patches', IDBKeyRange.bound(from, to)),
      `reading patches ${from}-${to}`
    );
    if (out.length !== to - from + 1) {
      throw new Error(
        `[FeedLog] patches ${from}-${to}: found ${out.length}, the log has gaps`
      );
    }
    return out;
  }

  async bridge(): Promise<FeedPatch[]> {
    const db = await this.open();
    const out = await withDeadline(db.getAll('bridge'), 'reading the bridge');
    return out.map((e) => e.patch);
  }

  async append(state: FeedState, patch: FeedPatch): Promise<FeedState> {
    const db = await this.open();
    const tx = db.transaction(['meta', 'patches', 'bridge'], 'readwrite');
    const next = appended(state);
    const work = (async () => {
      const patches = tx.objectStore('patches');
      const cur = state.currentVersion;
      if (cur < state.headVersion) {
        if (cur < state.anchorVersion) {
          const lost = await patches.getAll(
            IDBKeyRange.bound(cur + 1, state.anchorVersion)
          );
          const bridge = tx.objectStore('bridge');
          for (const rec of lost.reverse()) {
            await bridge.add({ patch: rec.patch });
          }
          next.bridgeLength = state.bridgeLength + lost.length;
          next.anchorVersion = cur;
          console.log(
            `[FeedLog] ${lost.length} patch(es) below the anchor moved to the bridge`
          );
        }
        await patches.delete(IDBKeyRange.lowerBound(cur, true));
      }
      await patches.put({
        version: next.currentVersion,
        patch,
        timestamp: Date.now(),
      });
      await tx.objectStore('meta').put({ key: STATE_KEY, ...next });
      await tx.done;
    })();
    await runTx(tx, work, `appending patch ${next.currentVersion}`);
    return next;
  }

  async saveState(state: FeedState): Promise<void> {
    const db = await this.open();
    await withDeadline(
      db.put('meta', { key: STATE_KEY, ...state }),
      'saving feed state'
    );
  }

  async commitBase(state: FeedState, clearPatches: boolean): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(['meta', 'patches', 'bridge'], 'readwrite');
    const work = (async () => {
      await tx.objectStore('bridge').clear();
      if (clearPatches) {
        await tx.objectStore('patches').clear();
      }
      await tx.objectStore('meta').put({ key: STATE_KEY, ...state });
      await tx.done;
    })();
    await runTx(tx, work, `committing base ${state.baseName}`);
  }
}

/** The same log for a session without storage. Nothing outlives the page. */
export class MemoryFeedLog implements FeedLog {
  readonly persistent = false;
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
}
