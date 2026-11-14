/**
 * Service Days Controller Module
 * Handles editing of GTFS calendar patterns and calendar exceptions
 * Provides auto-save functionality for service day modifications
 */

import type { Calendar, CalendarDates } from '../types/gtfs-entities';
import type { EditorFeed } from '../feed/editor-feed';
import { deleteOp, insertOp, updateOp } from '../feed/patch-build';
import { GTFSSchemas, GTFS_TABLES } from '../types/gtfs';
import { notify } from 'gtfs-zone-web-common/ui/notification-system';
import {
  getUsFederalDates,
  getUsFederalHolidays,
} from '../calendar-patterns/us-federal';
import { formatGtfsDateWithWeekday, fromInputValue } from '../utils/gtfs-date';
import {
  installEditableTableHandlers,
  renderEditableTable,
  type EditableTableConfig,
  type EditableTableDeps,
} from './editable-table';
import {
  renderInlineEditableField,
  renderInlineEntityFields,
} from '../utils/inline-editable-field';
import {
  generateFieldConfigsFromSchema,
  renderFieldLabel,
} from '../utils/field-component';
import { escapeHtml } from 'gtfs-zone-web-common/util/escape-html';
import {
  DAYS_OF_WEEK,
  renderWeekdayToggles,
  setWeekdayToggle,
} from '../utils/weekday-toggles';
import { defaultServiceRange } from '../utils/default-values';
import { t } from '../i18n/messages';

/**
 * ServiceDaysController - Manages GTFS calendar and calendar_dates editing
 *
 * This controller provides inline editing capabilities for:
 * - Weekly service patterns (calendar.txt)
 * - Service exceptions (calendar_dates.txt)
 * - Auto-save functionality following existing patterns
 *
 * Follows the Enhanced GTFS Object pattern and FAIL HARD error handling policy.
 */
export class ServiceDaysController {
  private savingIndicators: Set<string> = new Set();

  constructor(private readonly feed: EditorFeed) {}

  private calendarRow(service_id: string): Calendar | null {
    return this.feed.byKey('calendar', service_id) as Calendar | null;
  }

  private async exceptionsFor(service_id: string): Promise<CalendarDates[]> {
    return (await this.feed.find(
      'calendar_dates',
      'service_id',
      service_id
    )) as unknown as CalendarDates[];
  }

  // ===== PUBLIC RENDERING METHODS =====

  /**
   * Render service days editor for a specific service ID
   * Returns HTML to be embedded inline in existing object view
   *
   * @param service_id - GTFS service identifier
   * @returns Promise resolving to HTML string for the service editor
   */
  async renderServiceEditor(service_id: string): Promise<string> {
    try {
      // Get calendar and calendar_dates data
      const calendar = this.calendarRow(service_id);
      const exceptions = await this.exceptionsFor(service_id);

      return await this.renderServiceEditorHTML(
        service_id,
        calendar,
        exceptions
      );
    } catch (error) {
      console.error('Error rendering service editor:', error);
      return this.renderErrorHTML(t('svc.loadFailed'));
    }
  }

  // ===== PUBLIC EDITING METHODS =====

  /**
   * Toggle a day of the week for a service
   *
   * @param service_id - GTFS service identifier
   * @param dayKey - Day key (sunday, monday, etc.)
   */
  async toggleDay(service_id: string, dayKey: string): Promise<void> {
    try {
      this.showSavingIndicator(`day-${dayKey}-${service_id}`);

      // Get current calendar entry
      const calendar = this.calendarRow(service_id);

      if (!calendar) {
        // Derive date range from existing calendar_dates, fall back to the
        // default service range
        const existingDates = await this.exceptionsFor(service_id);
        let startDate: string;
        let endDate: string;
        if (existingDates.length > 0) {
          const sorted = existingDates.map((e) => e.date).sort();
          startDate = sorted[0];
          endDate = sorted[sorted.length - 1];
        } else {
          const range = defaultServiceRange(this.feed);
          startDate = range.start;
          endDate = range.end;
        }

        const created: Record<string, string> = {
          service_id,
          monday: '0',
          tuesday: '0',
          wednesday: '0',
          thursday: '0',
          friday: '0',
          saturday: '0',
          sunday: '0',
          start_date: startDate,
          end_date: endDate,
        };
        created[dayKey] = '1';
        await this.feed.apply([insertOp('calendar', created)]);
        // The service just gained a date range, which both the range editor
        // and the holidays checkbox render from.
        await this.refreshDateRangeDisplay(service_id);
        await this.refreshExceptionsDisplay(service_id);
      } else {
        // Toggle the day - handle both string and number values from database
        const currentValue = Number(
          (calendar as Record<string, unknown>)[dayKey]
        );
        const newValue = currentValue === 1 ? 0 : 1;

        await this.feed.apply([
          updateOp('calendar', calendar, { [dayKey]: newValue }),
        ]);
      }

      this.showSaveSuccess(`day-${dayKey}-${service_id}`);

      // Update button UI immediately to reflect new state
      this.updateDayButtonUI(service_id, dayKey);
    } catch (error) {
      console.error(`Failed to toggle ${dayKey}:`, error);
      this.showSaveError(
        `day-${dayKey}-${service_id}`,
        t('svc.dayFailed', { day: dayKey })
      );
    }
  }

  /**
   * Add a service exception
   *
   * @param service_id - GTFS service identifier
   * @param date - Date in YYYY-MM-DD format
   * @param exception_type - 1 for add service, 2 for remove service
   */
  async addException(
    service_id: string,
    date: string,
    exception_type: 1 | 2
  ): Promise<void> {
    try {
      this.showSavingIndicator('exceptions');

      const gtfsDate = fromInputValue(date);

      const existingRecord =
        (await this.exceptionsFor(service_id)).find(
          (e) => e.date === gtfsDate
        ) ?? null;

      if (existingRecord) {
        if (Number(existingRecord.exception_type) === exception_type) {
          // Already the correct type, no-op
          this.showSaveSuccess('exceptions');
          return;
        }
        // Different type, update in place
        await this.feed.apply([
          updateOp('calendar_dates', existingRecord, { exception_type }),
        ]);
        this.showSaveSuccess('exceptions');
        console.log(
          `[ServiceDaysController] Updated exception for service ${service_id} on ${gtfsDate} (type ${existingRecord.exception_type} -> ${exception_type})`
        );
      } else {
        const exceptionData: CalendarDates = {
          service_id,
          date: gtfsDate,
          exception_type,
        };
        await this.feed.apply([insertOp('calendar_dates', exceptionData)]);
        this.showSaveSuccess('exceptions');
        console.log(
          `[ServiceDaysController] Added exception for service ${service_id} on ${gtfsDate} (type ${exception_type})`
        );
      }
    } catch (error) {
      console.error('Failed to add exception:', error);
      this.showSaveError('exceptions', t('svc.addExceptionFailed'));
    }
  }

  // ===== PRIVATE HELPER METHODS =====

  /**
   * Render the main service editor HTML
   */
  private async renderServiceEditorHTML(
    service_id: string,
    calendar: Calendar | null,
    exceptions: CalendarDates[]
  ): Promise<string> {
    const serviceIdHTML = await this.renderServiceId(service_id, calendar);
    const weeklyPatternHTML = this.renderWeeklyPattern(service_id, calendar);
    const dateRangeHTML = await this.renderDateRange(service_id, calendar);
    const exceptionsHTML = await this.renderExceptions(
      service_id,
      calendar,
      exceptions
    );

    return `
      <div class="service-days-editor bg-base-200/50 p-4 rounded-lg">
        <div class="space-y-4">
          <div class="max-w-md">${serviceIdHTML}</div>

          <!-- Weekly Pattern -->
          <div class="weekly-pattern">
            <h4 class="text-sm font-semibold mb-2 text-base-content/80">${t('svc.weeklyPattern')}</h4>
            ${weeklyPatternHTML}
          </div>

          <!-- Date Range -->
          <div class="date-range" id="service-date-range-${service_id}">
            <h4 class="text-sm font-semibold mb-2 text-base-content/80">${t('svc.dateRange')}</h4>
            ${dateRangeHTML}
          </div>

          <!-- Exceptions -->
          <div class="exceptions">
            <h4 class="text-sm font-semibold mb-2 text-base-content/80">${t('svc.exceptions')}</h4>
            ${exceptionsHTML}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render weekly day pattern toggles
   */
  private renderWeeklyPattern(
    service_id: string,
    calendar: Calendar | null
  ): string {
    // Handle both string and number values from database
    const active = new Set<string>(
      DAYS_OF_WEEK.filter(
        ({ key }) =>
          calendar && Number((calendar as Record<string, unknown>)[key]) === 1
      ).map(({ key }) => key)
    );
    return renderWeekdayToggles(
      active,
      (key) =>
        `data-service-id="${service_id}" onclick="window.gtfsEditor.serviceDaysController.toggleDay('${service_id}', '${key}')"`,
      (key) => `
        <span class="saving-indicator" id="saving-day-${key}-${service_id}" style="display: none;">
          <span class="loading loading-spinner loading-xs"></span>
        </span>
      `
    );
  }

  /**
   * The service_id field, as a rename trigger.
   *
   * The rename cascade starts from the calendar.txt row, so a service that
   * lives only in calendar_dates.txt shows its ID read-only.
   */
  private async renderServiceId(
    service_id: string,
    calendar: Calendar | null
  ): Promise<string> {
    const config = generateFieldConfigsFromSchema(
      GTFSSchemas[GTFS_TABLES.CALENDAR],
      { service_id },
      GTFS_TABLES.CALENDAR
    ).find((c) => c.field === 'service_id');
    if (!config) {
      throw new Error('[ServiceDaysController] calendar has no service_id');
    }

    if (calendar) {
      return renderInlineEditableField({ ...config, recordId: service_id });
    }

    console.log(
      `[ServiceDaysController] ${service_id} has no calendar.txt row, so its service_id renders read-only`
    );
    return `
      <fieldset class="fieldset isolate">
        ${renderFieldLabel(config)}
        <span
          class="px-1 py-1.5 text-sm opacity-70"
          title="${t('svc.renameNeedsRow')}"
        >${escapeHtml(service_id)}</span>
      </fieldset>
    `;
  }

  /**
   * Start and end date, as the stacked entity fields every other page uses.
   *
   * A service with no calendar.txt row has no range of its own to edit, and a
   * field editor has no row to write to, so it says so instead.
   */
  private async renderDateRange(
    service_id: string,
    calendar: Calendar | null
  ): Promise<string> {
    if (!calendar) {
      return `
        <div class="text-xs text-base-content/60">
          ${t('svc.noCalendarRow')}
        </div>
      `;
    }

    const fieldsHtml = await renderInlineEntityFields(
      GTFS_TABLES.CALENDAR,
      calendar as unknown as Record<string, string | number | undefined>,
      service_id,
      [...DAYS_OF_WEEK.map((day) => day.key), 'service_id']
    );
    return `<div class="max-w-md">${fieldsHtml}</div>`;
  }

  /**
   * The exceptions, split by what they do: one list of dates that add service,
   * one of dates that remove it. The heading carries the meaning, so no row
   * needs a badge.
   */
  private async renderExceptions(
    service_id: string,
    calendar: Calendar | null,
    exceptions: CalendarDates[]
  ): Promise<string> {
    const deps: EditableTableDeps = { feed: this.feed };
    const byDate = (a: CalendarDates, b: CalendarDates) =>
      String(a.date).localeCompare(String(b.date));
    const added = exceptions
      .filter((e) => Number(e.exception_type) === 1)
      .sort(byDate);
    const removed = exceptions
      .filter((e) => Number(e.exception_type) === 2)
      .sort(byDate);

    const unavailable = `<div class="text-xs text-base-content/60">${t('svc.exceptionsUnavailable')}</div>`;
    const holidayNames = this.federalHolidayNames(calendar, exceptions);
    const addedHTML = deps
      ? await this.renderExceptionTable(
          service_id,
          deps,
          1,
          added,
          holidayNames
        )
      : unavailable;
    const removedHTML = deps
      ? await this.renderExceptionTable(
          service_id,
          deps,
          2,
          removed,
          holidayNames
        )
      : unavailable;

    return `
      <div id="service-exceptions-${service_id}" class="space-y-3">
        <div class="saving-indicator" id="saving-exceptions" style="display: none;">
          <span class="loading loading-spinner loading-xs"></span>
        </div>

        <div class="space-y-1">
          <h5 class="text-xs font-semibold text-base-content/70">${t('svc.added')}</h5>
          ${addedHTML}
        </div>

        <div class="space-y-1">
          <h5 class="text-xs font-semibold text-base-content/70">${t('svc.removed')}</h5>
          ${this.renderHolidaysCheckbox(service_id, calendar, exceptions)}
          ${removedHTML}
        </div>
      </div>
    `;
  }

  /**
   * One exception list as an editable table over `calendar_dates`.
   *
   * Only the date is a column: the service and the exception type are what the
   * list is, so they ride along as fixed values on every row it inserts. The
   * insert itself goes through `addException`, which reconciles a date that is
   * already in the other list instead of colliding with it.
   */
  private async renderExceptionTable(
    service_id: string,
    deps: EditableTableDeps,
    exception_type: 1 | 2,
    rows: CalendarDates[],
    holidayNames: Map<string, string>
  ): Promise<string> {
    const config: EditableTableConfig = {
      instanceId: `calendar-dates-${exception_type}-${service_id}`,
      tableName: GTFS_TABLES.CALENDAR_DATES,
      fields: ['date'],
      rows: rows as unknown as Record<string, unknown>[],
      deps,
      columnOverrides: {
        date: {
          format: (value) => {
            const date = String(value ?? '');
            if (!/^\d{8}$/.test(date)) {
              return date;
            }
            const text = formatGtfsDateWithWeekday(date);
            // Only the removed list names the holiday: that is the list a
            // holiday explains being in.
            const name =
              exception_type === 2 ? holidayNames.get(date) : undefined;
            return name ? `${text} - ${name}` : text;
          },
        },
      },
      fixedValues: { service_id, exception_type },
      emptyMessage:
        exception_type === 1 ? t('svc.noAdded') : t('svc.noRemoved'),
      insertRow: async (record) => {
        const date = fromInputValue(String(record.date ?? ''));
        if (!/^\d{8}$/.test(date)) {
          return t('svc.enterDate');
        }
        await this.addException(service_id, date, exception_type);
        return null;
      },
      onInsert: () => void this.refreshExceptionsDisplay(service_id),
      onDelete: () => void this.refreshExceptionsDisplay(service_id),
      onRowsChanged: () => void this.refreshExceptionsDisplay(service_id),
    };

    // Re-registered on every render, so the handlers always hold the rows on
    // screen. The instance outlives the panel, but its cells do not.
    installEditableTableHandlers(config);
    return renderEditableTable(config);
  }

  /**
   * The federal-holidays convenience above the removed list.
   *
   * Nothing about it is stored: it is checked when every federal holiday in
   * the service's date range already has a removed-service row, and a partial
   * state reads as unchecked.
   */
  private renderHolidaysCheckbox(
    service_id: string,
    calendar: Calendar | null,
    exceptions: CalendarDates[]
  ): string {
    const holidays = this.federalHolidayDates(calendar, exceptions);
    const removedDates = new Set(
      exceptions
        .filter((e) => Number(e.exception_type) === 2)
        .map((e) => String(e.date))
    );
    const checked =
      holidays.length > 0 && holidays.every((date) => removedDates.has(date));
    const title =
      holidays.length === 0
        ? t('svc.setRangeFirst')
        : t('svc.holidaysInRange', { count: holidays.length });

    return `
      <label class="label cursor-pointer justify-start gap-2 py-1" title="${title}">
        <input
          type="checkbox"
          class="toggle toggle-xs"
          ${checked ? 'checked' : ''}
          ${holidays.length === 0 ? 'disabled' : ''}
          onchange="window.gtfsEditor.serviceDaysController.toggleFederalHolidays('${service_id}')"
        />
        <span class="label-text text-xs">${t('svc.excludeHolidays')}</span>
      </label>
    `;
  }

  /**
   * Observed US federal holiday dates inside the service's date range, sorted.
   *
   * Empty when the service has no usable range, which is what disables the
   * checkbox: there is nothing to add dates to.
   */
  /**
   * Observed federal holiday date to name, over the years the calendar spans.
   *
   * Unlike `federalHolidayDates` this is not clipped to the service's start and
   * end: an exception date outside the range still deserves its name.
   */
  private federalHolidayNames(
    calendar: Calendar | null,
    exceptions: CalendarDates[]
  ): Map<string, string> {
    const range = this.getYearsRange(calendar, exceptions);
    const years = exceptions
      .map((e) => parseInt(String(e.date).substring(0, 4)))
      .filter((year) => Number.isFinite(year));
    const startYear = Math.min(range.startYear, ...years);
    const endYear = Math.max(range.endYear, ...years);
    const names = new Map<string, string>();
    for (let year = startYear; year <= endYear; year++) {
      for (const holiday of getUsFederalHolidays(year)) {
        names.set(holiday.date, holiday.name);
      }
    }
    return names;
  }

  private federalHolidayDates(
    calendar: Calendar | null,
    exceptions: CalendarDates[]
  ): string[] {
    const start = String(calendar?.start_date ?? '');
    const end = String(calendar?.end_date ?? '');
    if (!/^\d{8}$/.test(start) || !/^\d{8}$/.test(end) || start > end) {
      return [];
    }

    const { startYear, endYear } = this.getYearsRange(calendar, exceptions);
    const dates: string[] = [];
    for (let year = startYear; year <= endYear; year++) {
      for (const date of getUsFederalDates(year)) {
        if (date >= start && date <= end) {
          dates.push(date);
        }
      }
    }
    return dates.sort();
  }

  /**
   * Put every federal holiday in range on the removed list, or take them all
   * off it again. One undo step either way.
   *
   * Checking also flips a holiday that was on the added list: the label
   * promises the holidays are excluded, so leaving one added would contradict
   * both the label and the checkbox it fails to check.
   */
  async toggleFederalHolidays(service_id: string): Promise<void> {
    try {
      this.showSavingIndicator('exceptions');

      const calendar = this.calendarRow(service_id);
      const exceptions = await this.exceptionsFor(service_id);
      const holidays = this.federalHolidayDates(calendar, exceptions);
      if (holidays.length === 0) {
        this.showSaveError('exceptions', t('svc.setRangeBeforeHolidays'));
        return;
      }

      const byDate = new Map(exceptions.map((e) => [String(e.date), e]));
      const holidaySet = new Set(holidays);
      const allRemoved = holidays.every(
        (date) => Number(byDate.get(date)?.exception_type) === 2
      );
      const table = 'calendar_dates';

      if (allRemoved) {
        const removed = exceptions.filter((e) =>
          holidaySet.has(String(e.date))
        );
        await this.feed.apply(
          removed.map((e) => deleteOp(table, e)),
          t('svc.includeHolidaysLabel')
        );
        console.log(
          `[ServiceDaysController] Removed ${removed.length} federal holiday rows for ${service_id}`
        );
      } else {
        const inserts: CalendarDates[] = holidays
          .filter((date) => !byDate.has(date))
          .map((date) => ({ service_id, date, exception_type: 2 as const }));
        const flips = holidays
          .map((date) => byDate.get(date))
          .filter(
            (row): row is CalendarDates =>
              row !== undefined && Number(row.exception_type) !== 2
          );
        await this.feed.apply(
          [
            ...inserts.map((row) => insertOp(table, row)),
            ...flips.map((row) => updateOp(table, row, { exception_type: 2 })),
          ],
          t('svc.excludeHolidaysLabel')
        );
        console.log(
          `[ServiceDaysController] Excluded federal holidays for ${service_id} (+${inserts.length}, flipped ${flips.length})`
        );
      }

      this.showSaveSuccess('exceptions');
      await this.refreshExceptionsDisplay(service_id);
    } catch (error) {
      console.error('Failed to toggle federal holidays:', error);
      this.showSaveError('exceptions', t('svc.holidaysFailed'));
    }
  }

  /**
   * Derive year range from calendar dates or exception dates
   */
  private getYearsRange(
    calendar: Calendar | null,
    exceptions: CalendarDates[]
  ): { startYear: number; endYear: number } {
    if (calendar?.start_date && calendar?.end_date) {
      return {
        startYear: parseInt(calendar.start_date.substring(0, 4)),
        endYear: parseInt(calendar.end_date.substring(0, 4)),
      };
    }
    if (exceptions.length === 0) {
      const y = new Date().getFullYear();
      return { startYear: y, endYear: y };
    }
    const years = exceptions.map((e) => parseInt(e.date.substring(0, 4)));
    return { startYear: Math.min(...years), endYear: Math.max(...years) };
  }

  /**
   * Re-render the date range section after the calendar row appears.
   */
  private async refreshDateRangeDisplay(service_id: string): Promise<void> {
    const container = document.getElementById(
      `service-date-range-${service_id}`
    );
    if (!container) {
      return;
    }
    const calendar = this.calendarRow(service_id);
    container.innerHTML = `
      <h4 class="text-sm font-semibold mb-2 text-base-content/80">${t('svc.dateRange')}</h4>
      ${await this.renderDateRange(service_id, calendar)}
    `;
  }

  /**
   * Refresh exceptions display after changes
   */
  async refreshExceptionsDisplay(service_id: string): Promise<void> {
    try {
      const calendar = this.calendarRow(service_id);
      const exceptions = await this.exceptionsFor(service_id);
      const container = document.getElementById(
        `service-exceptions-${service_id}`
      );
      if (container) {
        container.outerHTML = await this.renderExceptions(
          service_id,
          calendar,
          exceptions
        );
      }
    } catch (error) {
      console.error(
        '[ServiceDaysController] Failed to refresh exceptions display:',
        error
      );
    }
  }

  /**
   * Update day button UI to reflect current database state
   */
  private async updateDayButtonUI(
    service_id: string,
    dayKey: string
  ): Promise<void> {
    try {
      const calendar = this.calendarRow(service_id);

      if (!calendar) {
        return;
      }

      // Get current value from database
      const isActive =
        Number((calendar as Record<string, unknown>)[dayKey]) === 1;

      // Find the button and update its classes
      const button = document.querySelector(
        `button[data-service-id="${service_id}"][data-day="${dayKey}"]`
      ) as HTMLButtonElement;

      if (button) {
        setWeekdayToggle(button, isActive);
      }
    } catch (error) {
      console.error(`Failed to update day button UI for ${dayKey}:`, error);
    }
  }

  /**
   * Show saving indicator
   */
  private showSavingIndicator(elementId: string): void {
    this.savingIndicators.add(elementId);
    const indicator = document.getElementById(`saving-${elementId}`);
    if (indicator) {
      indicator.style.display = 'inline-block';
    }
  }

  /**
   * Show save success
   */
  private showSaveSuccess(elementId: string): void {
    this.savingIndicators.delete(elementId);
    const indicator = document.getElementById(`saving-${elementId}`);
    if (indicator) {
      indicator.style.display = 'none';
    }
  }

  /**
   * Show save error
   */
  private showSaveError(elementId: string, message: string): void {
    this.savingIndicators.delete(elementId);
    const indicator = document.getElementById(`saving-${elementId}`);
    if (indicator) {
      indicator.style.display = 'none';
    }
    notify.error(message, { duration: 5000 });
  }

  /**
   * Render error HTML
   */
  private renderErrorHTML(message: string): string {
    return `
      <div class="alert alert-error">
        <span>${message}</span>
      </div>
    `;
  }
}
