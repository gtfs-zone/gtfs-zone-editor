/**
 * Loading a feed into the EditorFeed, with the progress bar: import from a
 * URL or a file, restore the stored feed, or start an empty one.
 *
 * The open feed is released before a new one loads, so two feeds are never
 * in memory together. When an import is cancelled or fails, the stored feed
 * (untouched, since the import never committed) is restored and the error
 * rethrown for the caller to report.
 *
 * Cancel stops the download, parse or restore. Saving a new base (import
 * commit, fold) cannot be cancelled: the bar drops its Cancel button there.
 */

import { zipSync } from 'fflate';
import {
  LoadCancelledError,
  downloadPercent,
  formatBytes,
} from 'gtfs-zone-web-common/gtfs/feed-download';
import type { LoadProgress } from 'gtfs-zone-web-common/gtfs/store/store-client';
import { notify } from 'gtfs-zone-web-common/ui/notification-system';
import { feedProgressIndicator } from 'gtfs-zone-web-common/ui/progress-indicator';
import { t } from '../i18n/messages';
import type { EditorFeed } from './editor-feed';
import { importFeed, openStoredFeed, recoverStoredFeedZip } from './feed-boot';
import type { Persistence } from './feed-worker-api';

const OPERATION = 'feed-load';

let inFlight = false;
let sessionNoticeShown = false;

function progressStatus(label: string, p: LoadProgress): string {
  if (p.stage === 'index') {
    return t('parse.buildingIndexes');
  }
  if (p.stage === 'restore') {
    return t('parse.readingStored');
  }
  const name = p.table ? `${p.table}.txt` : label;
  return p.total
    ? t('parse.readingProgress', {
        name,
        done: formatBytes(p.bytes),
        total: formatBytes(p.total),
      })
    : t('parse.readingProgressNoTotal', { name, done: formatBytes(p.bytes) });
}

/** Run `body` under the progress bar, with Cancel until `lockCancel`. */
async function withProgress<T>(
  status: string,
  body: (hooks: {
    signal: AbortSignal;
    onProgress: (p: LoadProgress) => void;
    lockCancel: (status: string) => void;
  }) => Promise<T>,
  label: string
): Promise<T> {
  if (inFlight) {
    throw new Error(t('parse.busy'));
  }
  inFlight = true;
  const controller = new AbortController();
  feedProgressIndicator.startLoading(OPERATION, status, {
    onCancel: () => controller.abort(),
  });
  try {
    return await body({
      signal: controller.signal,
      onProgress: (p) =>
        feedProgressIndicator.updateProgress(
          OPERATION,
          p.stage === 'read' ? (downloadPercent(p.bytes, p.total) ?? 0) : 100,
          progressStatus(label, p)
        ),
      lockCancel: (next) => {
        feedProgressIndicator.startLoading(OPERATION, next);
      },
    });
  } finally {
    inFlight = false;
    feedProgressIndicator.finishLoading(OPERATION);
  }
}

function announcePersistence(persistence: Persistence): void {
  if (persistence !== 'session' || sessionNoticeShown) {
    return;
  }
  sessionNoticeShown = true;
  notify.warning(t('parse.sessionOnly'), {
    autoHide: false,
    actions: [
      {
        id: 'export',
        label: t('nav.export'),
        primary: true,
        handler: () => document.getElementById('export-btn')?.click(),
      },
    ],
  });
}

/**
 * Parse a feed and make it the open, stored feed. Throws
 * `LoadCancelledError` on a cancel; either way the stored feed is back
 * open afterwards when there is one.
 */
export async function loadFeed(
  feed: EditorFeed,
  input: { url: string } | { file: File },
  label: string
): Promise<void> {
  await withProgress(
    t('parse.preparing'),
    async ({ signal, onProgress, lockCancel }) => {
      feed.release();
      let result: Awaited<ReturnType<typeof importFeed>>;
      try {
        result = await importFeed(input, label, {
          signal,
          onProgress,
          onSaving: () => lockCancel(t('parse.saving')),
        });
      } catch (err) {
        console.warn(
          `[FeedLoader] import of ${label} ${err instanceof LoadCancelledError ? 'cancelled' : 'failed'}; reopening the stored feed`
        );
        await reopenStored(feed);
        throw err;
      }
      const { client, imported } = result;
      await feed.adopt(client, imported.state, imported.persistence);
      announcePersistence(imported.persistence);
      if (imported.ignoredRouteNetworks > 0) {
        notify.warning(
          t('parse.networkConflict', { count: imported.ignoredRouteNetworks }),
          { duration: 12000 }
        );
      }
    },
    label
  );
}

/** Reopen the stored feed after a failed import, without a progress bar of its own. */
async function reopenStored(feed: EditorFeed): Promise<void> {
  try {
    const opened = await openStoredFeed();
    if (opened) {
      await feed.adopt(
        opened.client,
        opened.opened.state,
        opened.opened.persistence
      );
    }
  } catch (err) {
    console.error('[FeedLoader] could not reopen the stored feed', err);
  }
}

/**
 * Open the stored feed (folding a long log first). False when none is
 * stored. Throws `LoadCancelledError` on a cancel, leaving no feed open.
 */
export async function restoreFeed(feed: EditorFeed): Promise<boolean> {
  return withProgress(
    t('parse.openingStored'),
    async ({ signal, onProgress, lockCancel }) => {
      feed.release();
      const opened = await openStoredFeed({
        signal,
        onProgress,
        onFolding: () => lockCancel(t('parse.compacting')),
      });
      if (!opened) {
        return false;
      }
      // A cancel during the replay lands after the worker finished.
      if (signal.aborted) {
        opened.client.release();
        throw new LoadCancelledError();
      }
      await feed.adopt(
        opened.client,
        opened.opened.state,
        opened.opened.persistence
      );
      announcePersistence(opened.opened.persistence);
      if (opened.foldError) {
        notify.warning(t('parse.foldFailed', { message: opened.foldError }), {
          autoHide: false,
        });
      }
      return true;
    },
    ''
  );
}

/** Start a new, empty feed: an empty archive through the import path. */
export async function createEmptyFeed(
  feed: EditorFeed,
  label: string
): Promise<void> {
  const bytes = zipSync({});
  const file = new File([bytes], 'empty.zip', { type: 'application/zip' });
  await loadFeed(feed, { file }, label);
}

/**
 * The stored feed as a zip when it cannot be opened, for the database error
 * modal. `note` says how much of the edit history it holds when not all.
 */
export async function recoverStoredFeedExport(): Promise<{
  zip: Blob;
  note: string | null;
}> {
  feedProgressIndicator.startLoading('recover-export', t('export.preparing'));
  try {
    const { zip, recovered } = await recoverStoredFeedZip({
      onProgress: (p) =>
        feedProgressIndicator.updateProgress(
          'recover-export',
          p.totalRows > 0 ? Math.min(100, (100 * p.rows) / p.totalRows) : 0,
          t('export.writing', { file: p.file })
        ),
    });
    const note = recovered.error
      ? t('db.recoveryPartial', {
          applied: recovered.applied,
          total: recovered.total,
          message: recovered.error,
        })
      : null;
    return { zip, note };
  } finally {
    feedProgressIndicator.finishLoading('recover-export');
  }
}
