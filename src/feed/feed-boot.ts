/**
 * Starting a feed worker (main thread): import a new feed, restore a stored
 * one, list or delete stored feeds, or wipe the storage.
 *
 * A restore whose replay is past the fold threshold runs in two workers:
 * the first replays, folds and saves a new base, and is terminated (which
 * frees its whole heap); the second restores from that base.
 */

import {
  FeedStoreClient,
  type LoadHooks,
  type LoadOptions,
  type StoreApi,
} from 'gtfs-zone-web-common/gtfs/store/store-client';
import {
  clearBaseFiles,
  deleteBaseFile,
} from 'gtfs-zone-web-common/gtfs/store/opfs-base';
import { LoadCancelledError } from 'gtfs-zone-web-common/gtfs/feed-download';
import { CONFIG } from '../config';
import { deleteDatabaseWithTimeout } from '../utils/idb-request';
import { FeedDb, type FeedState } from './feed-log';
import type { ExportStep } from './feed-export';
import type {
  FeedWorkerApi,
  Imported,
  Opened,
  Recovered,
} from './feed-worker-api';

/** Every table but these is mirrored to the main thread. */
export const WORKER_ONLY_TABLES: readonly string[] = [
  'trips',
  'stop_times',
  'shapes',
  'calendar_dates',
  'transfers',
  'translations',
];

const FEED_LOAD_OPTIONS: LoadOptions = {
  stopTimes: 'full',
  keepFiles: true,
  mirror: { except: [...WORKER_ONLY_TABLES] },
};

export type FeedClient = FeedStoreClient<FeedWorkerApi & StoreApi>;

function createWorker(): Worker {
  return new Worker(new URL('../workers/feed.worker.ts', import.meta.url), {
    type: 'module',
  });
}

/** Run `fn` on a fresh connection, closed after. */
async function withDb<T>(fn: (db: FeedDb) => Promise<T>): Promise<T> {
  const db = new FeedDb();
  try {
    return await fn(db);
  } finally {
    db.close();
  }
}

/**
 * The active feed's state, or null when none is stored or storage is
 * unavailable.
 */
export async function readActiveFeedState(): Promise<FeedState | null> {
  try {
    return await withDb((db) => db.active());
  } catch (err) {
    console.warn('[FeedBoot] could not read the active feed', err);
    return null;
  }
}

/**
 * Every stored feed, most recently opened first; empty when storage is
 * unavailable.
 */
export async function listStoredFeeds(): Promise<FeedState[]> {
  try {
    return await withDb((db) => db.list());
  } catch (err) {
    console.warn('[FeedBoot] could not list stored feeds', err);
    return [];
  }
}

/** Delete a stored feed and its base file. The caller releases it first. */
export async function deleteStoredFeed(id: string): Promise<void> {
  const baseName = await withDb((db) => db.delete(id));
  if (baseName) {
    await deleteBaseFile(baseName);
  }
  console.log(
    `[FeedBoot] deleted stored feed ${id} (${baseName ?? 'no base'})`
  );
}

/** An HTTP date as YYYY-MM-DD, or null when absent or unparseable. */
function isoDay(httpDate: string | null | undefined): string | null {
  if (!httpDate) {
    return null;
  }
  const ms = Date.parse(httpDate);
  if (Number.isNaN(ms)) {
    console.warn(`[FeedBoot] unparseable Last-Modified: ${httpDate}`);
    return null;
  }
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Parse a feed and store it as a new, active feed. The caller releases the
 * previous feed's client first, so two feeds are never in memory together.
 * `sourceUrl` is the unproxied schedule URL, for the newer-version check.
 */
export async function importFeed(
  input: { url: string } | { file: File },
  label: string,
  sourceUrl: string | null,
  hooks: LoadHooks & { onSaving?: () => void } = {}
): Promise<{ client: FeedClient; imported: Imported }> {
  const client = await FeedStoreClient.load<FeedWorkerApi>(
    input,
    FEED_LOAD_OPTIONS,
    hooks,
    createWorker
  );
  // The signal stops reaching the worker once the load resolves; a cancel
  // in between lands here. From the save on, the import runs to the end.
  if (hooks.signal?.aborted) {
    client.release();
    throw new LoadCancelledError();
  }
  hooks.onSaving?.();
  try {
    const imported = await client.call('commitImport', label, {
      url: sourceUrl,
      modified: isoDay(client.loaded.source?.lastModified),
    });
    return { client, imported };
  } catch (err) {
    client.release();
    throw err;
  }
}

async function restore(
  feedId: string,
  baseName: string,
  hooks: LoadHooks
): Promise<{ client: FeedClient; opened: Opened }> {
  const client = await FeedStoreClient.load<FeedWorkerApi>(
    { base: baseName },
    FEED_LOAD_OPTIONS,
    hooks,
    createWorker
  );
  try {
    return { client, opened: await client.call('open', feedId, baseName) };
  } catch (err) {
    client.release();
    throw err;
  }
}

/** Feed `id`'s state, or the active feed's when `id` is omitted. */
async function storedState(id?: string): Promise<FeedState | null> {
  return id ? withDb((db) => db.get(id)) : readActiveFeedState();
}

/**
 * Restore stored feed `id` (the active one when omitted) and make it
 * active, folding first when its log is long. Null when there is no such
 * feed. A failed fold is not fatal: the replayed worker stays in use and
 * `foldError` says why the fold failed.
 */
export async function openStoredFeed(
  id?: string,
  hooks: LoadHooks & { onFolding?: () => void } = {}
): Promise<{
  client: FeedClient;
  opened: Opened;
  foldError?: string;
} | null> {
  const state = await storedState(id);
  if (!state?.baseName) {
    console.log(`[FeedBoot] no stored feed ${id ?? '(active)'}`);
    return null;
  }
  const first = await restore(state.id, state.baseName, hooks);
  if (!first.opened.foldDue) {
    return first;
  }
  console.log(
    `[FeedBoot] ${first.opened.replayed} patches to replay (> ${CONFIG.FEED_FOLD_PATCHES}): folding`
  );
  if (hooks.signal?.aborted) {
    first.client.release();
    throw new LoadCancelledError();
  }
  hooks.onFolding?.();
  let baseName: string;
  try {
    baseName = await first.client.call('compact');
  } catch (err) {
    const foldError = err instanceof Error ? err.message : String(err);
    console.error('[FeedBoot] fold failed; keeping the replayed feed', err);
    return { ...first, foldError };
  }
  first.client.release();
  return restore(state.id, baseName, hooks);
}

export type ExportProgress = Extract<ExportStep, { done: false }>;

/**
 * Build the feed's zip in the worker, one step per call. An abort drops the
 * export in the worker and throws `LoadCancelledError`.
 */
export async function exportZip(
  client: FeedClient,
  hooks: { onProgress?: (p: ExportProgress) => void; signal?: AbortSignal } = {}
): Promise<Blob> {
  for (;;) {
    if (hooks.signal?.aborted) {
      await client.call('exportCancel');
      throw new LoadCancelledError();
    }
    const step = await client.call('exportStep');
    if (step.done) {
      return step.zip;
    }
    hooks.onProgress?.(step);
  }
}

/**
 * Export stored feed `id` (the active one when omitted) when it cannot be
 * opened: its base, plus as much of the patch log as still applies. Runs in
 * its own worker, released after.
 */
export async function recoverStoredFeedZip(
  id?: string,
  hooks: { onProgress?: (p: ExportProgress) => void } = {}
): Promise<{ zip: Blob; recovered: Recovered }> {
  const state = await storedState(id);
  if (!state?.baseName) {
    throw new Error('[FeedBoot] no stored feed to recover');
  }
  const client = await FeedStoreClient.load<FeedWorkerApi>(
    { base: state.baseName },
    FEED_LOAD_OPTIONS,
    {},
    createWorker
  );
  try {
    const recovered = await client.call('recover', state.id, state.baseName);
    const zip = await exportZip(client, hooks);
    console.log(
      `[FeedBoot] recovery export: ${recovered.applied} of ${recovered.total} patch(es), ${zip.size} bytes`
    );
    return { zip, recovered };
  } finally {
    client.release();
  }
}

/**
 * Delete every stored feed (Settings -> Reset). Release the client first:
 * an open connection or file handle blocks the delete.
 */
export async function resetFeedStorage(): Promise<
  'deleted' | 'blocked' | 'error'
> {
  await clearBaseFiles();
  const outcome = await deleteDatabaseWithTimeout(CONFIG.FEED_DB_NAME);
  console.log(`[FeedBoot] reset: base files cleared, database ${outcome}`);
  return outcome;
}
