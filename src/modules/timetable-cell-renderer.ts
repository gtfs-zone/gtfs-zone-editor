/**
 * Timetable Cell Renderer Module
 * Handles HTML generation for individual stop_time cells
 */

import { TimeFormatter, renderTimeHtml } from '../utils/time-formatter';
import { EditableStopTime } from './timetable-data-processor';
import type { StopTimeRef } from 'gtfs-zone-web-common/gtfs/types';
import { escapeHtml } from 'gtfs-zone-web-common/util/escape-html';
import { getEnumOptions } from '../types/gtfs-enums';
import {
  COMPACT_ICON_FIELDS,
  POPOVER_STOP_TIME_FIELDS,
  TimetableViewMode,
  stopTimeFieldKind,
} from './timetable-fields';
import {
  renderMoreFieldsIcon,
  renderStopTimeFieldIcon,
} from './stop-time-icons';
import { FieldPresence, stopTimeFieldPresence } from '../utils/flex-rules';
import { formatIssueValue, isDanglingReference } from './feed-issues';
import { tooltipContentAttr } from 'gtfs-zone-web-common/ui/field-label';
import { renderPickerTrigger } from '../utils/picker-trigger';
import {
  buildFieldTooltipContent,
  renderSpecFieldLabelContent,
} from '../utils/field-component';
import { t } from '../i18n/messages';

/** Everything one cell needs to render its stack of sub-rows. */
export interface StopTimeCellParams {
  trip_id: string;
  stop_id: string;
  /** Position in the supersequence, the row's real key */
  stopIndex: number;
  /** The roster of visible fields, in spec order, for the whole table */
  fields: readonly string[];
  /** The trip's stop_time at this row, when it has one */
  editableStopTime?: EditableStopTime;
  /** Row is the not-yet-saved add-stop preview */
  isPendingRow: boolean;
  /** The pending row references a zone or location group */
  isPendingFlex: boolean;
  /** What the whole row references, whether or not this trip serves it */
  rowRef?: StopTimeRef;
  /**
   * The trip's first departure, set only on a frequency-based trip. Every time
   * sub-row then carries its offset from it in the tooltip: in headway service
   * the stored times are a template and only the offsets carry meaning.
   */
  frequencyOrigin: string | null;
  /** This row is the trip's first stop_sequence: arrival_time is required. */
  isFirstStop: boolean;
  /** This row is the trip's last stop_sequence: arrival_time is required. */
  isLastStop: boolean;
  /** The trip's out-of-order times, from timeOrderWarnings. */
  orderWarnings: TimeOrderWarnings;
  /** Compact: times, icons and a popover. Explicit: one sub-row per field. */
  mode: TimetableViewMode;
}

/** What every field span of one cell shares, derived from its params. */
interface CellContext {
  record: EditableStopTime | null;
  presence: Map<string, FieldPresence>;
  isWindowed: boolean;
  refAttrs: string;
  stopSequence: string;
}

/**
 * Where a compact cell puts a time span. `main` is the dominant time,
 * `secondary` the small arrival above it, `slot` the same line dimmed (empty
 * or equal to the main time), `collapsed` a zero-height span focus expands.
 */
type CompactRole = 'main' | 'secondary' | 'slot' | 'collapsed';

const COMPACT_ROLE_CLASS: Record<CompactRole, string> = {
  main: 'order-2 text-sm h-6 leading-6',
  secondary: 'order-1 text-[10px] h-4 leading-4 opacity-70',
  slot: 'order-1 text-[10px] h-4 leading-4 opacity-40',
  collapsed: 'text-[10px] h-0 leading-4 focus:h-4',
};

const EXPLICIT_SIZE_CLASS = 'text-xs h-6 leading-6';

/**
 * A trip's times that run earlier than the time before them, keyed by
 * orderWarningKey, each mapped to that earlier-in-sequence time.
 */
export type TimeOrderWarnings = ReadonlyMap<string, string>;

const ORDERED_TIME_FIELDS = ['arrival_time', 'departure_time'] as const;

function orderWarningKey(stopIndex: number, field: string): string {
  return `${stopIndex}:${field}`;
}

/**
 * Flag each time earlier than the last non-empty time before it, walking the
 * trip's rows in stop_sequence order (arrival before departure in each row).
 * Only the offending time is flagged: the walk continues from it, so one late
 * stop does not mark the rest of the trip.
 */
export function timeOrderWarnings(
  stopTimes: ReadonlyMap<number, EditableStopTime> | undefined
): TimeOrderWarnings {
  const warnings = new Map<string, string>();
  if (!stopTimes) {
    return warnings;
  }
  const rows = [...stopTimes.entries()].sort(
    ([, a], [, b]) => parseInt(a.stop_sequence) - parseInt(b.stop_sequence)
  );
  let previous: { time: string; seconds: number } | null = null;
  for (const [stopIndex, record] of rows) {
    for (const field of ORDERED_TIME_FIELDS) {
      const time = record[field];
      const seconds = TimeFormatter.timeToSeconds(time);
      if (time === null || seconds === null) {
        continue;
      }
      if (previous && seconds < previous.seconds) {
        warnings.set(orderWarningKey(stopIndex, field), previous.time);
      }
      previous = { time, seconds };
    }
  }
  return warnings;
}

/** Which stop_times field a row ref lands in, for the presence rules. */
const REF_FIELD: Record<StopTimeRef['kind'], string> = {
  stop: 'stop_id',
  location_group: 'location_group_id',
  location: 'location_id',
};

/**
 * The stop_times row the presence rules judge, rebuilt from the cell's record.
 *
 * `EditableStopTime` splits the row's reference out into `ref`, but the rules
 * read `location_group_id` / `location_id` off the row itself, so the ref has
 * to be folded back in.
 */
function presenceRow(record: EditableStopTime): Record<string, unknown> {
  const row: Record<string, unknown> = { ...record };
  delete row.ref;
  row[REF_FIELD[record.ref.kind]] = record.ref.id;
  return row;
}

/** The offset of `time` from the trip's first departure, as `+MM:SS`. */
function offsetLabel(time: string, origin: string): string | null {
  const at = TimeFormatter.timeToSeconds(time);
  const from = TimeFormatter.timeToSeconds(origin);
  if (at === null || from === null) {
    return null;
  }
  return t('tt.fromFirstDeparture', {
    offset: TimeFormatter.formatSignedDuration(at - from),
  });
}

/**
 * Timetable Cell Renderer - HTML generation for individual stop_time cells
 *
 * A cell is a vertical stack of labeled sub-rows, one `<span class="time-span">`
 * per visible stop_times field. The roster is the same for every cell in the
 * table (see visibleStopTimeFields), which is what keeps the grid rectangular
 * for keyboard navigation: a windowed row and a scheduled row share a column,
 * so both pairs of time fields are in the roster whenever either is used.
 *
 * Editing is handled entirely by ScheduleController's delegated click handler,
 * which swaps a span for a live editor on click - see installTimetablePickers.
 *
 * Every span renders with `tabindex="-1"`. ScheduleController promotes exactly
 * one of them to `tabindex="0"` after each render (see applyTimetableSelection),
 * so Tab enters the grid at a single cell instead of walking all few thousand.
 */
export class TimetableCellRenderer {
  /**
   * Render one trip's cell at one row of the timetable.
   *
   * The row's ref decides the cell shape, not this trip's stop_time: a zone row
   * is a zone row on every trip, including the trips that do not serve it.
   * Routing on the saved stop_time instead is what used to render a zone's
   * unserved cells as arrival/departure spans and let a keystroke write a
   * stop_time with a zone id in stop_id.
   *
   * A flex ref's spans carry `data-flex-kind`/`data-flex-id` and deliberately
   * *no* `data-stop-id`. The row's synthetic stop carries the ref id as its
   * `stop_id`, so emitting it here would feed the arrival/departure insert path
   * a zone id as a `stops.txt` foreign key.
   */
  public renderStopTimeCell(params: StopTimeCellParams): string {
    const { trip_id, stopIndex, isPendingRow, frequencyOrigin, orderWarnings } =
      params;
    const cell = this.cellContext(params);
    const { record, isWindowed } = cell;

    // A flex row legitimately has no arrival or departure and is not a skipped
    // stop, so it must never take the `no-time` path.
    const isSkipped =
      !isWindowed && !record?.arrival_time && !record?.departure_time;
    const cellClass = [
      'time-cell group align-top p-2 text-center',
      isWindowed ? 'flex-window-cell' : isSkipped ? 'no-time' : 'has-time',
    ].join(' ');

    if (params.mode === 'compact') {
      return `
        <td class="${cellClass}">
          <div class="stacked-time-container flex flex-col">${this.renderCompactContent(params, cell)}</div>
        </td>
      `;
    }

    const spans = params.fields
      .map((field) =>
        this.renderFieldSpan({
          field,
          trip_id,
          stopIndex,
          cell,
          isPendingRow,
          frequencyOrigin,
          earlierThan: orderWarnings.get(orderWarningKey(stopIndex, field)),
          inGrid: true,
          sizeClass: EXPLICIT_SIZE_CLASS,
        })
      )
      .join('');

    // The roster is table-wide, so a field the user wants to edit here is added
    // to every cell. Hidden until the cell is hovered or focused, or the grid
    // would be littered with plus signs.
    const addFieldTip =
      `<div>${t('tt.addFieldTitle', { file: '<code>stop_times.txt</code>' })}</div>` +
      `<div class="opacity-70">${t('tt.addFieldText')}</div>`;
    const addField = `
      <button
        type="button"
        class="add-field-btn field-tooltip-trigger btn btn-ghost btn-xs h-4 min-h-0 w-full opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        data-trip-id="${escapeHtml(trip_id)}"
        data-stop-index="${stopIndex}"
        ${tooltipContentAttr(addFieldTip)}
      >+</button>
    `;

    return `
      <td class="${cellClass}">
        <div class="stacked-time-container">${spans}${addField}</div>
      </td>
    `;
  }

  /**
   * The body of a compact popover: one row per non-time field of a stop_time,
   * each value a span that opens the same editor as its explicit sub-row.
   */
  public renderStopTimePopover(params: StopTimeCellParams): string {
    const cell = this.cellContext(params);
    return POPOVER_STOP_TIME_FIELDS.map((field) => {
      const span = this.renderFieldSpan({
        field,
        trip_id: params.trip_id,
        stopIndex: params.stopIndex,
        cell,
        isPendingRow: params.isPendingRow,
        frequencyOrigin: null,
        inGrid: false,
        sizeClass: EXPLICIT_SIZE_CLASS,
      });
      return `
        <div class="flex items-center gap-2 min-w-0">
          <div class="w-44 shrink-0 truncate text-right font-mono text-xs opacity-60">${renderSpecFieldLabelContent('stop_times.txt', field, field)}</div>
          <div class="min-w-0 flex-1">${span}</div>
        </div>
      `;
    }).join('');
  }

  /** The record, presence rules and ref attributes every span of a cell uses. */
  private cellContext(params: StopTimeCellParams): CellContext {
    const { stop_id, editableStopTime, isPendingFlex, rowRef } = params;
    const record = editableStopTime ?? null;
    // Advisory decoration only: validateFlexStopTimeRow is still the gate that
    // decides whether an edit commits. A cell with no record has no row to
    // judge, and its non-time sub-rows are already non-editable.
    const presence = record
      ? stopTimeFieldPresence(presenceRow(record), {
          isFirst: params.isFirstStop,
          isLast: params.isLastStop,
        })
      : new Map<string, FieldPresence>();
    const isFlexRow =
      (rowRef !== undefined && rowRef.kind !== 'stop') ||
      record?.isFlex === true ||
      isPendingFlex;
    const isWindowed =
      isFlexRow ||
      !!record?.start_pickup_drop_off_window ||
      !!record?.end_pickup_drop_off_window;

    const isStopRef = rowRef === undefined || rowRef.kind === 'stop';
    const refAttrs = isStopRef
      ? `data-stop-id="${escapeHtml(stop_id)}"`
      : `data-flex-kind="${escapeHtml(rowRef.kind)}" data-flex-id="${escapeHtml(rowRef.id)}"`;
    return {
      record,
      presence,
      isWindowed,
      refAttrs,
      stopSequence: record?.stop_sequence ?? '',
    };
  }

  /**
   * A compact cell: the time spans laid out by role, then a strip of icons
   * for the non-default enum fields and the popover marker.
   *
   * Every roster field still renders a `.time-span` in DOM order, so the grid
   * stride and arrow navigation are the same as in explicit mode. Only the
   * visual order (flex `order-*`) and size change.
   */
  private renderCompactContent(
    params: StopTimeCellParams,
    cell: CellContext
  ): string {
    const { trip_id, stopIndex, isPendingRow, frequencyOrigin, orderWarnings } =
      params;
    const roles = this.compactRoles(params.fields, cell);

    const spans = params.fields
      .map((field) =>
        this.renderFieldSpan({
          field,
          trip_id,
          stopIndex,
          cell,
          isPendingRow,
          frequencyOrigin,
          earlierThan: orderWarnings.get(orderWarningKey(stopIndex, field)),
          inGrid: true,
          sizeClass: COMPACT_ROLE_CLASS[roles.get(field) ?? 'collapsed'],
        })
      )
      .join('');

    return `${spans}${this.renderCompactStrip(params, cell)}`;
  }

  /**
   * Which role each time span plays in a compact cell.
   *
   * A scheduled cell shows the departure as the main time, or the arrival when
   * it is the only one set. The other one always sits small above it: dimmed
   * when empty or equal to the main time, so it stays a click target. A windowed cell shows both window
   * ends as main times and collapses arrival/departure.
   */
  private compactRoles(
    fields: readonly string[],
    cell: CellContext
  ): Map<string, CompactRole> {
    const roles = new Map<string, CompactRole>(
      fields.map((field) => [field, 'collapsed'])
    );
    if (cell.isWindowed) {
      for (const field of fields) {
        if (field !== 'arrival_time' && field !== 'departure_time') {
          roles.set(field, 'main');
        }
      }
      return roles;
    }

    const arrival = cell.record?.arrival_time ?? '';
    const departure = cell.record?.departure_time ?? '';
    if (departure === '' && arrival !== '') {
      roles.set('arrival_time', 'main');
      roles.set('departure_time', 'slot');
    } else {
      roles.set('departure_time', 'main');
      roles.set(
        'arrival_time',
        arrival !== '' && arrival !== departure ? 'secondary' : 'slot'
      );
    }
    return roles;
  }

  /**
   * The compact cell's bottom line: an icon per non-default enum field, and a
   * marker that opens the popover listing every non-time field.
   *
   * The icons and the marker are mouse targets outside the grid (no
   * `.time-span`, tabindex -1). The marker is solid when some other field is
   * set, and otherwise appears on hover only.
   */
  private renderCompactStrip(
    params: StopTimeCellParams,
    cell: CellContext
  ): string {
    const { record, refAttrs, stopSequence, isWindowed, presence } = cell;
    if (!record) {
      return '<div class="order-3 h-4"></div>';
    }
    const row = record as unknown as Record<string, unknown>;
    const valueOf = (field: string): string => {
      const raw = row[field];
      return raw === null || raw === undefined ? '' : String(raw);
    };

    const dataAttrs = (field: string) => `
        data-trip-id="${escapeHtml(params.trip_id)}"
        ${refAttrs}
        data-stop-index="${params.stopIndex}"
        data-field="${escapeHtml(field)}"
        data-field-kind="${stopTimeFieldKind(field)}"
        data-stop-sequence="${escapeHtml(stopSequence)}"
        data-value="${escapeHtml(valueOf(field))}"
        data-windowed="${isWindowed}"`;

    const icons = COMPACT_ICON_FIELDS.map((field) => {
      const value = valueOf(field);
      const icon = renderStopTimeFieldIcon(field, value);
      if (!icon) {
        return '';
      }
      const forbidden = presence.get(field)?.state === 'forbidden';
      const reason = presence.get(field)?.reason;
      // The value first, then why it is flagged, then the field's spec entry.
      const tip =
        `<div><code>${escapeHtml(field)}</code> = ${escapeHtml(this.displayValue(field, 'enum', value))}</div>` +
        (reason ? `<div class="text-error">${escapeHtml(reason)}</div>` : '') +
        buildFieldTooltipContent({
          field,
          label: field,
          type: 'select',
          tableName: 'stop_times.txt',
        });
      return `<button
          type="button"
          tabindex="-1"
          class="stop-time-icon field-tooltip-trigger inline-flex items-center rounded px-0.5 cursor-pointer hover:bg-base-200 ${forbidden ? 'text-error' : ''}"
          ${dataAttrs(field)}
          ${tooltipContentAttr(tip)}
        >${icon}</button>`;
    }).join('');

    const otherSet = POPOVER_STOP_TIME_FIELDS.some(
      (field) => !COMPACT_ICON_FIELDS.includes(field) && valueOf(field) !== ''
    );
    const marker = `<button
        type="button"
        tabindex="-1"
        class="stop-time-more field-tooltip-trigger inline-flex items-center rounded px-0.5 cursor-pointer hover:bg-base-200 ${otherSet ? 'text-primary' : 'opacity-0 group-hover:opacity-60'}"
        data-trip-id="${escapeHtml(params.trip_id)}"
        data-stop-index="${params.stopIndex}"
        ${tooltipContentAttr(escapeHtml(otherSet ? t('tt.moreFieldsSet') : t('tt.moreFields')))}
      >${renderMoreFieldsIcon()}</button>`;

    return `<div class="order-3 flex items-center justify-center gap-0.5 h-4">${icons}${marker}</div>`;
  }

  /** One field's sub-row: a display span the click handler swaps for an editor. */
  private renderFieldSpan(args: {
    field: string;
    trip_id: string;
    stopIndex: number;
    cell: CellContext;
    isPendingRow: boolean;
    frequencyOrigin: string | null;
    /** The previous time this one runs earlier than, when out of order. */
    earlierThan?: string;
    /** A grid cell (`.time-span`) or a popover row outside the grid. */
    inGrid: boolean;
    /** Font size, height and layout classes for the span's slot. */
    sizeClass: string;
  }): string {
    const {
      field,
      trip_id,
      stopIndex,
      cell,
      isPendingRow,
      frequencyOrigin,
      earlierThan,
      inGrid,
      sizeClass,
    } = args;
    const { refAttrs, stopSequence, record, isWindowed } = cell;
    const presence = cell.presence.get(field);

    const kind = stopTimeFieldKind(field);
    const raw = record
      ? ((record as unknown as Record<string, unknown>)[field] ?? null)
      : null;
    const value = raw === null || raw === undefined ? '' : String(raw);

    // A value the spec forbids here stays editable, so it can be cleared from
    // the grid. Only an empty forbidden field is inert: there is nothing to fix
    // and offering an editor would invite writing a violation.
    const forbiddenEmpty = presence?.state === 'forbidden' && value === '';

    // Only a time edit may create a stop_time: every other field is an edit to
    // an existing record, and there is nothing to address it to without one.
    const editable = (record !== null || kind === 'time') && !forbiddenEmpty;

    const dangling =
      kind === 'booking_rule' &&
      isDanglingReference('stop_times.txt', field, value);

    const titleParts = [field];
    if (kind === 'time' && value && frequencyOrigin) {
      const offset = offsetLabel(value, frequencyOrigin);
      if (offset) {
        titleParts.push(offset);
      }
    }
    if (earlierThan) {
      titleParts.push(t('tt.earlierThanPrevious', { time: earlierThan }));
    }
    if (presence?.reason) {
      titleParts.push(presence.reason);
    }
    if (dangling) {
      titleParts.push(
        t('tt.noRecord', { field, value: formatIssueValue(value) })
      );
    }
    if (!editable && !forbiddenEmpty) {
      titleParts.push(t('tt.noStopTimeYet'));
    }

    // A booking rule is picked from a modal, so its sub-row wears the shared
    // trigger shape. Only when it is editable: a chevron on an inert cell
    // promises a picker that will not open.
    const isPicker = kind === 'booking_rule' && editable;

    // A picker sub-row is inline-flex, so baseline alignment would leave the
    // strut's descender under it and push the sub-rows below out of line with
    // their labels. align-top keeps every sub-row exactly h-6.
    const classes = [
      `${inGrid ? 'time-span' : 'stop-time-popover-field'} field-tooltip-trigger font-mono ${sizeClass} rounded px-1 ${isPicker ? 'w-full align-top' : 'block truncate'}`,
      kind === 'time' && isWindowed ? 'text-info' : '',
      // A forbidden value and a dangling reference read the same way: an error
      // that is still editable, exactly as renderPropertyCell shows one.
      (presence?.state === 'forbidden' && value !== '') || dangling
        ? 'text-error font-semibold'
        : '',
      earlierThan ? 'text-error font-semibold bg-error/10' : '',
      presence?.state === 'required' ? 'text-warning' : '',
      forbiddenEmpty
        ? 'opacity-40 cursor-not-allowed pointer-events-none'
        : editable
          ? 'cursor-pointer hover:bg-base-200 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary'
          : 'opacity-40 cursor-default',
    ]
      .filter(Boolean)
      .join(' ');

    const attrs = `
        ${inGrid ? 'role="gridcell"' : ''}
        tabindex="-1"
        data-trip-id="${escapeHtml(trip_id)}"
        ${refAttrs}
        data-stop-index="${stopIndex}"
        data-field="${escapeHtml(field)}"
        data-field-kind="${kind}"
        data-stop-sequence="${escapeHtml(stopSequence)}"
        data-value="${escapeHtml(value)}"
        data-pending="${isPendingRow}"
        data-windowed="${isWindowed}"
        ${editable ? '' : 'data-disabled="true"'}
        ${
          // The portal tooltip shows on keyboard focus too, so a warning is
          // reachable without a pointer.
          tooltipContentAttr(
            [
              `<code>${escapeHtml(field)}</code>`,
              ...titleParts.slice(1).map(escapeHtml),
            ].join('<br>')
          )
        }`;
    const display =
      kind === 'time'
        ? renderTimeHtml(value)
        : escapeHtml(this.displayValue(field, kind, value));

    if (isPicker) {
      return renderPickerTrigger({
        content: display,
        variant: 'bare',
        className: classes,
        attrs,
      });
    }

    return `<span class="${classes}" ${attrs}>${display}</span>`;
  }

  /**
   * What a non-time sub-row shows: enums as `value - Short Label`, everything
   * else raw. Empty renders as `-`. Times go through renderTimeHtml instead.
   */
  private displayValue(field: string, kind: string, value: string): string {
    if (value === '') {
      return '-';
    }
    if (kind === 'enum') {
      const option = (getEnumOptions(field) ?? []).find(
        (opt) => String(opt.value) === value
      );
      return option ? `${value} - ${option.label}` : value;
    }
    return value;
  }
}
