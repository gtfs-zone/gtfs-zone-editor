/**
 * New Service Modal
 *
 * Asks for a new `calendar.txt` row: its service_id (prefilled with the next
 * free `service_<n>`), its date range and its weekly pattern. The fields and
 * toggles are the service page's own, committing into a draft record that
 * Create writes as one insert.
 *
 * The row is written here, so the caller only has to deal with the
 * new service_id it resolves with.
 */

import { promptNewEntity } from './entity-form-modal';
import { nextServiceId } from '../utils/inline-entity-creator';
import { notify } from 'gtfs-zone-web-common/ui/notification-system';
import {
  createDefaultService,
  defaultServiceRange,
} from '../utils/default-values';
import type { EditorFeed } from '../feed/editor-feed';
import { insertOp } from '../feed/patch-build';
import {
  renderWeekdayToggles,
  setWeekdayToggle,
} from '../utils/weekday-toggles';
import { setDraftValue } from '../utils/inline-editable-field';
import { t } from '../i18n/messages';

/**
 * Ask for a new service and write it.
 *
 * Resolves with the created `service_id`, or `null` when cancelled. Zero days
 * selected is allowed: a service that only runs on `calendar_dates` exception
 * dates is legal, and the service page can add those afterwards.
 */
export async function showNewServiceModal(
  feed: EditorFeed
): Promise<string | null> {
  const suggested = await nextServiceId(feed);
  const defaults = createDefaultService(suggested, defaultServiceRange(feed));

  let service_id: string | null = null;

  const values = await promptNewEntity({
    title: t('newSvc.title'),
    boxClassName: 'max-w-lg',
    id: {
      table: 'calendar',
      suggested,
      // nextServiceId skips these, so a typed ID has to as well.
      taken: async (id) =>
        (await feed.findOne('calendar_dates', 'service_id', id))
          ? t('newSvc.idHasExceptions', { id })
          : null,
    },
    fields: [
      {
        field: 'start_date',
        tableName: 'calendar.txt',
        value: defaults.start_date,
      },
      {
        field: 'end_date',
        tableName: 'calendar.txt',
        value: defaults.end_date,
      },
    ],
    draft: defaults as unknown as Record<string, unknown>,
    extraBody: `
      <div class="new-service-days">
        <h4 class="text-sm font-semibold mb-2 text-base-content/80">${t('svc.weeklyPattern')}</h4>
        ${renderWeekdayToggles(new Set(), () => '')}
      </div>
    `,
    onMount: (_close, draftId) => {
      const days = new Set<string>();
      document
        .querySelectorAll<HTMLButtonElement>('.new-service-days .day-toggle')
        .forEach((btn) => {
          btn.addEventListener('click', () => {
            const key = btn.dataset.day;
            if (!key) {
              return;
            }
            const on = !days.has(key);
            if (on) {
              days.add(key);
            } else {
              days.delete(key);
            }
            setDraftValue(draftId, key, on ? 1 : 0);
            setWeekdayToggle(btn, on);
          });
        });
    },
    validate: (v) => {
      if (v.start_date === '' || v.end_date === '') {
        return t('newSvc.needsDates');
      }
      if (v.end_date < v.start_date) {
        return t('newSvc.endBeforeStart');
      }
      return null;
    },
    onCreate: async (v, row) => {
      const id = v.service_id;
      console.log('[NewServiceModal] creating service', id, row);
      await feed.apply([insertOp('calendar', row)]);

      service_id = id;
      notify.success(t('newSvc.created', { id }));
    },
  });

  return values ? service_id : null;
}
