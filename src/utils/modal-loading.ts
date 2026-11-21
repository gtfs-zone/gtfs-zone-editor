import { t } from '../i18n/messages';

/** Spinner a modal body shows while its worker calls are in flight. */
export function renderModalLoading(): string {
  return `<div class="flex items-center gap-2 py-6 justify-center text-sm opacity-70" data-modal-loading><span class="loading loading-spinner loading-sm"></span>${t('common.loading')}</div>`;
}
