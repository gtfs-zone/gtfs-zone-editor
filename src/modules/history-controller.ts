import type { EditorFeed } from '../feed/editor-feed';
import type { FeedPatch } from '../types/patch';
import { humanLabel } from '../utils/patch-label';
import { t } from '../i18n/messages';

function escHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function relativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) {
    return t('history.secondsAgo', { n: diffSec });
  }
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return t('history.minutesAgo', { n: diffMin });
  }
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) {
    return t('history.hoursAgo', { n: diffHr });
  }
  return t('history.daysAgo', { n: Math.floor(diffHr / 24) });
}

function opBadgeClass(op: FeedPatch['op']): string {
  if (op === 'insert') {
    return 'badge-success';
  }
  if (op === 'update') {
    return 'badge-warning';
  }
  if (op === 'batch' || op === 'file') {
    return 'badge-info';
  }
  return 'badge-error';
}

function renderFieldDiffs(patch: FeedPatch): string {
  if (patch.op === 'file') {
    return '';
  }
  if (patch.op === 'batch') {
    const opTypes = new Set(patch.ops.map((op) => op.op));
    let key:
      | 'history.rowsInserted'
      | 'history.rowsDeleted'
      | 'history.rowsUpdated'
      | 'history.rowsChanged';
    if (opTypes.size === 1) {
      const op = opTypes.values().next().value;
      key =
        op === 'insert'
          ? 'history.rowsInserted'
          : op === 'delete'
            ? 'history.rowsDeleted'
            : 'history.rowsUpdated';
    } else {
      key = 'history.rowsChanged';
    }
    return `<div class="text-xs mt-0.5">${t(key, { count: patch.ops.length })}</div>`;
  }
  if (patch.op === 'update') {
    const before = (patch.inverse as { changes: Record<string, unknown> })
      .changes;
    const after = (patch.forward as { changes: Record<string, unknown> })
      .changes;
    return Object.entries(before)
      .map(
        ([field, bVal]) =>
          `<div class="text-xs mt-0.5"><span class="opacity-60">${escHtml(field)}:</span> <span class="line-through opacity-50">"${escHtml(bVal)}"</span> -&gt; <span>"${escHtml(after[field])}"</span></div>`
      )
      .join('');
  }
  if (patch.op === 'insert') {
    const record = (patch.forward as { record: Record<string, unknown> })
      .record;
    const entries = Object.entries(record).slice(0, 4);
    const more =
      Object.keys(record).length > 4
        ? `<div class="text-xs opacity-50 mt-0.5">…</div>`
        : '';
    return (
      entries
        .map(
          ([field, val]) =>
            `<div class="text-xs mt-0.5"><span class="opacity-60">${escHtml(field)}:</span> "${escHtml(val)}"</div>`
        )
        .join('') + more
    );
  }
  if (patch.op === 'delete') {
    const record = (patch.inverse as { record: Record<string, unknown> })
      .record;
    const entries = Object.entries(record).slice(0, 4);
    const more =
      Object.keys(record).length > 4
        ? `<div class="text-xs opacity-50 mt-0.5">…</div>`
        : '';
    return (
      entries
        .map(
          ([field, val]) =>
            `<div class="text-xs mt-0.5"><span class="opacity-60">${escHtml(field)}:</span> "${escHtml(val)}"</div>`
        )
        .join('') + more
    );
  }
  return '';
}

export class HistoryController {
  private feed!: EditorFeed;

  initialize(feed: EditorFeed): void {
    this.feed = feed;

    const rerender = () => {
      this.render().catch((e: unknown) =>
        console.error('HistoryController render failed:', e)
      );
    };

    feed.onEdit(rerender);
    feed.onFeedReplaced(rerender);

    // History modal triggers render via index.ts (history-btn click listener)
  }

  async render(): Promise<void> {
    const panel = document.getElementById('changes-panel');
    if (!panel) {
      return;
    }

    if (!this.feed.isOpen) {
      panel.innerHTML = '';
      return;
    }
    const history = await this.feed.history();
    const currentVersion = this.feed.version;

    panel.innerHTML = '';

    // Patch list: newest first, with baseline row at the bottom
    const ul = document.createElement('ul');
    ul.className = 'divide-y divide-base-300';

    if (history.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className =
        'flex flex-col items-center justify-center py-16 text-base-content/40';
      emptyDiv.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span class="text-sm">${t('history.empty')}</span>`;
      panel.appendChild(emptyDiv);
    } else {
      for (let i = history.length - 1; i >= 0; i--) {
        const record = history[i];
        const { patch, timestamp, version, applied } = record;
        const isCurrent = version === currentVersion;

        const li = document.createElement('li');
        li.className = [
          'flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-base-200 transition-colors',
          isCurrent ? 'bg-base-200 border-l-2 border-primary' : '',
        ].join(' ');

        const textClass = applied ? '' : 'opacity-50';

        li.innerHTML = `
          <div class="flex flex-col gap-1 min-w-0 flex-1">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="badge badge-sm ${opBadgeClass(patch.op)}">${t(`history.op.${patch.op}`)}</span>
              <span class="text-xs truncate ${textClass}">${escHtml(humanLabel(patch))}</span>
            </div>
            <div class="text-base-content/70">${renderFieldDiffs(patch)}</div>
            <span class="text-xs text-base-content/40">${relativeTime(timestamp)}</span>
          </div>`;

        li.addEventListener('click', () => {
          this.feed
            .jumpTo(version)
            .catch((e: unknown) => console.error('jumpToVersion failed:', e));
        });

        ul.appendChild(li);
      }
    }

    // Baseline row: always shown at the bottom, styled as a peer of patch cards
    const isOrigin = currentVersion === 0;
    const baselineLi = document.createElement('li');
    baselineLi.className = [
      'flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-base-200 transition-colors',
      isOrigin ? 'bg-base-200 border-l-2 border-primary' : '',
    ].join(' ');
    baselineLi.innerHTML = `
      <div class="flex flex-col gap-1 min-w-0 flex-1">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="badge badge-ghost badge-sm">${t('history.origin')}</span>
          <span class="text-xs">${t('history.feedLoaded')}</span>
        </div>
      </div>`;
    baselineLi.addEventListener('click', () => {
      this.feed
        .jumpTo(0)
        .catch((e: unknown) => console.error('jumpToVersion(0) failed:', e));
    });
    ul.appendChild(baselineLi);

    panel.appendChild(ul);
  }
}
