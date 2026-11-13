/**
 * The editor's methods on top of the store worker (runs in the worker).
 *
 * The worker owns the patch log: every edit, undo, redo and jump applies to
 * the store and is written to the log before the call replies. A failed
 * apply leaves neither a store change nor a logged patch; a failed write
 * takes the store change back.
 *
 * Lifecycle, driven by `feed-boot.ts`:
 * - import: `load({ url | file })`, then `commitImport(label)`.
 * - restore: `load({ base })`, then `open(baseName)`; `compact()` folds the
 *   log into a new base when `open` says it is due.
 */

import type { FeedStore } from 'gtfs-zone-web-common/gtfs/store/feed-store';
import type { StoreContext } from 'gtfs-zone-web-common/gtfs/store/store-worker-core';
import {
  deleteBaseFile,
  saveBaseFile,
  sweepBaseFiles,
} from 'gtfs-zone-web-common/gtfs/store/opfs-base';
import { CONFIG } from '../config';
import type { FeedPatch, FeedPatchRecord, PatchRename } from '../types/patch';
import { applyPatch, applyPatches } from './patch-apply';
import { patchTargets } from './patch-build';
import {
  IdbFeedLog,
  MemoryFeedLog,
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
}

export interface Opened {
  state: FeedState;
  persistence: Persistence;
  /** Patches replayed onto the base (bridge included). */
  replayed: number;
  /** True when `compact()` should run before the session starts. */
  foldDue: boolean;
}

export interface Imported {
  state: FeedState;
  persistence: Persistence;
  /** Routes whose `network_id` was ignored for networks.txt. */
  ignoredRouteNetworks: number;
}

/** The persistence the browser allows; OPFS missing means session only. */
async function createLog(): Promise<FeedLog> {
  try {
    if (!navigator.storage?.getDirectory) {
      throw new Error('navigator.storage.getDirectory is missing');
    }
    await navigator.storage.getDirectory();
    return new IdbFeedLog();
  } catch (err) {
    console.warn('[FeedWorker] no OPFS; this session saves nothing', err);
    return new MemoryFeedLog();
  }
}

function newBaseName(): string {
  const rand = Math.floor(Math.random() * 1e9).toString(36);
  return `base-${Date.now().toString(36)}-${rand}.bin`;
}

/** Save a base, turning a full disk into a message the user can act on. */
async function saveBase(
  store: FeedStore,
  ctx: StoreContext,
  name: string
): Promise<void> {
  try {
    await saveBaseFile(store, ctx.stream(), name);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'QuotaExceededError') {
      throw new Error(
        'The browser has no room left to store this feed. Free up disk space or remove site data, then try again.',
        { cause: err }
      );
    }
    throw err;
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
  let logPromise: Promise<FeedLog> | null = null;
  let state: FeedState | null = null;

  const getLog = (): Promise<FeedLog> => (logPromise ??= createLog());
  const persistence = async (): Promise<Persistence> =>
    (await getLog()).persistent ? 'opfs' : 'session';

  const requireState = (): FeedState => {
    if (!state) {
      throw new Error('[FeedWorker] no feed opened; call open or commitImport');
    }
    return state;
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
    next: FeedState
  ): Promise<Moved> => {
    const log = await getLog();
    const store = ctx.store();
    applyPatches(store, patches, dir);
    try {
      await log.saveState(next);
    } catch (err) {
      const back = dir === 'forward' ? 'inverse' : 'forward';
      applyPatches(store, [...patches].reverse(), back);
      throw err;
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

  const sweep = async (keep: string): Promise<void> => {
    try {
      const gone = await sweepBaseFiles([keep]);
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
    applyPatch(store, patch, 'forward');
    try {
      state = await log.append(s, patch);
    } catch (err) {
      applyPatch(store, patch, 'inverse');
      throw err;
    }
    console.log(`[FeedWorker] recorded patch ${state.currentVersion}`);
    return versions();
  };

  const decode = (bytes: Uint8Array | null): string | null =>
    bytes === null ? null : new TextDecoder().decode(bytes);

  return {
    persistence,

    /**
     * After `load({ url | file })`: normalise, fold that into the base, save
     * it and make it the stored feed, with an empty log. The previous
     * feed's base is deleted only once the new one is committed.
     */
    commitImport: async (label: string): Promise<Imported> => {
      if (state) {
        throw new Error('[FeedWorker] a feed is already open in this worker');
      }
      const { mode, ignored } = normalizeNetworks(ctx.store());
      if (ctx.store().hasEdits()) {
        ctx.replaceStore(ctx.store().fold());
      }
      const log = await getLog();
      const previous = await log.state();
      const next: FeedState = {
        baseName: log.persistent ? newBaseName() : '',
        label,
        anchorVersion: 0,
        currentVersion: 0,
        headVersion: 0,
        bridgeLength: 0,
        networksMode: mode,
        extensionColumns: {},
        importedAt: Date.now(),
      };
      if (next.baseName) {
        await saveBase(ctx.store(), ctx, next.baseName);
      }
      await commitBase(log, next, true);
      state = next;
      if (next.baseName) {
        if (previous?.baseName) {
          await deleteBaseFile(previous.baseName).catch((e: unknown) =>
            console.warn('[FeedWorker] could not delete the old base', e)
          );
        }
        await sweep(next.baseName);
      }
      console.log(
        `[FeedWorker] imported ${label} as ${next.baseName || '(session)'}`
      );
      return {
        state: { ...next },
        persistence: await persistence(),
        ignoredRouteNetworks: ignored,
      };
    },

    /**
     * After `load({ base })`: bring the store from the base to the current
     * version (bridge inverses, then the log forward or inverse).
     */
    open: async (baseName: string): Promise<Opened> => {
      if (state) {
        throw new Error('[FeedWorker] a feed is already open in this worker');
      }
      const log = await getLog();
      const s = await log.state();
      if (!s) {
        throw new Error('[FeedWorker] no stored feed');
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
        `[FeedWorker] opened ${baseName} at version ${s.currentVersion}: ${replayed} patch(es) replayed in ${Math.round(performance.now() - t0)}ms`
      );
      await sweep(baseName);
      return {
        state: { ...s },
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
      const next: FeedState = {
        ...s,
        baseName: newBaseName(),
        anchorVersion: s.currentVersion,
        bridgeLength: 0,
      };
      await saveBase(folded, ctx, next.baseName);
      await commitBase(log, next, false);
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

    /** A non-table entry as text, or null when the feed has none. */
    fileText: (name: string): string | null => decode(ctx.store().file(name)),

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
