/**
 * Starting a feed worker (main thread): import a new feed, restore the
 * stored one, or wipe the storage.
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
import { clearBaseFiles } from 'gtfs-zone-web-common/gtfs/store/opfs-base';
import { LoadCancelledError } from 'gtfs-zone-web-common/gtfs/feed-download';
import { CONFIG } from '../config';
import { deleteDatabaseWithTimeout } from '../utils/idb-request';
import { IdbFeedLog, type FeedState } from './feed-log';
import type { FeedWorkerApi, Imported, Opened } from './feed-worker-api';

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

/**
 * The stored feed's state, or null when none is stored or storage is
 * unavailable. Opens and closes its own connection.
 */
export async function readStoredFeedState(): Promise<FeedState | null> {
  const log = new IdbFeedLog();
  try {
    return await log.state();
  } catch (err) {
    console.warn('[FeedBoot] could not read the stored feed', err);
    return null;
  } finally {
    log.close();
  }
}

/**
 * Parse a feed and make it the stored feed. The caller releases the
 * previous feed's client first, so two feeds are never in memory together.
 */
export async function importFeed(
  input: { url: string } | { file: File },
  label: string,
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
    const imported = await client.call('commitImport', label);
    return { client, imported };
  } catch (err) {
    client.release();
    throw err;
  }
}

async function restore(
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
    return { client, opened: await client.call('open', baseName) };
  } catch (err) {
    client.release();
    throw err;
  }
}

/**
 * Restore the stored feed, folding first when its log is long. Null when
 * none. A failed fold is not fatal: the replayed worker stays in use and
 * `foldError` says why the fold failed.
 */
export async function openStoredFeed(
  hooks: LoadHooks & { onFolding?: () => void } = {}
): Promise<{
  client: FeedClient;
  opened: Opened;
  foldError?: string;
} | null> {
  const state = await readStoredFeedState();
  if (!state?.baseName) {
    console.log('[FeedBoot] no stored feed');
    return null;
  }
  const first = await restore(state.baseName, hooks);
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
  return restore(baseName, hooks);
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
