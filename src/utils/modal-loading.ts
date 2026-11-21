import { t } from '../i18n/messages';

/** Spinner a modal body shows while its worker calls are in flight. */
export function renderModalLoading(): string {
  return `<div class="flex items-center gap-2 py-6 justify-center text-sm opacity-70" data-modal-loading><span class="loading loading-spinner loading-sm"></span>${t('common.loading')}</div>`;
}

/** "Show N more" button for a list that renders its rows a page at a time. */
export function renderShowMore(remaining: number, page: number): string {
  if (remaining <= 0) {
    return '';
  }
  return `<button type="button" class="btn btn-xs btn-ghost" data-show-more>${t('common.showMore', { count: Math.min(remaining, page) })}</button>`;
}
