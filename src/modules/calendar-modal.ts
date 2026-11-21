import { renderTriangleIcon } from 'gtfs-zone-web-common/ui/modal-utils';
import type { DateCodec } from 'gtfs-zone-web-common/ui/calendar-input';
import {
  renderMonthGrid,
  showCalendarModal as showSharedCalendarModal,
} from 'gtfs-zone-web-common/ui/calendar-modal';
import { escapeHtml } from 'gtfs-zone-web-common/util/escape-html';
import { CONFIG } from '../config';
import { parseGtfsDate, toGtfsDate, todayGtfsDate } from '../utils/gtfs-date';
import { feedBounds, trimOrExtendServices } from '../utils/feed-bounds';
import type { EditorFeed } from '../feed/editor-feed';
import { notify } from 'gtfs-zone-web-common/ui/notification-system';
import {
  attachServiceTimelineListeners,
  getServiceColor,
  isServiceActive,
  loadTripCounts,
  NO_DATE,
  renderNoTimeline,
  renderServiceTimelineFrame,
  renderServiceTimelineRows,
  timelineFrame,
  type ServiceData,
  type TimelineSpan,
} from './service-timeline';
import {
  bindListSearch,
  mountLazyList,
  type LazyList,
} from 'gtfs-zone-web-common/ui/lazy-list';
import { renderModalLoading } from '../utils/modal-loading';
import { t } from '../i18n/messages';

export interface CalendarModalDeps {
  feed: EditorFeed;
  onServiceClick: (service_id: string) => void;
}

const GTFS_DATE_CODEC: DateCodec = { parse: parseGtfsDate, format: toGtfsDate };

const DAY_MS = 86_400_000;

function renderServiceChip(sid: string, sd: ServiceData, date: string): string {
  const excForDay = sd.exceptions.find((e) => String(e.date) === date);
  let suffix = '';
  if (excForDay) {
    suffix =
      Number(excForDay.exception_type) === 1
        ? renderTriangleIcon('h-3 w-3 shrink-0 -rotate-90 text-success')
        : renderTriangleIcon('h-3 w-3 shrink-0 rotate-90 text-error');
  }
  return `<span
    class="cal-chip field-tooltip-trigger cursor-pointer inline-flex items-center gap-0.5 px-1 rounded text-xs text-white font-medium truncate max-w-full"
    style="background-color:${escapeHtml(sd.color)}"
    data-service-id="${escapeHtml(sid)}"
    data-tooltip-content="${escapeHtml(sid)}"
  >${escapeHtml(sd.label)}${suffix}</span>`;
}

function renderFeedEdgeBadges(
  date: string,
  feedStartDate: string | null,
  feedEndDate: string | null
): string {
  const start =
    date === feedStartDate
      ? `<span class="badge badge-xs badge-success ml-1 field-tooltip-trigger" tabindex="0" data-tooltip-content="${t('cal.feedStart')}">${renderTriangleIcon('h-2 w-2')}</span>`
      : '';
  const end =
    date === feedEndDate
      ? `<span class="badge badge-xs badge-error ml-1 field-tooltip-trigger" tabindex="0" data-tooltip-content="${t('cal.feedEnd')}">${renderTriangleIcon('h-2 w-2 rotate-180')}</span>`
      : '';
  return start + end;
}

/** What the modal knows of every service without reading calendar_dates rows. */
interface CalendarIndex {
  calendar: Map<string, Record<string, unknown>>;
  color: Map<string, string>;
  tripCounts: Map<string, number>;
  /** Timeline row order: first date, last date, busiest, service_id. */
  order: string[];
  span: TimelineSpan | null;
}

type Exceptions = Record<string, unknown>[];

async function loadCalendarIndex(feed: EditorFeed): Promise<CalendarIndex> {
  const [bounds, tripCounts] = await Promise.all([
    feed.exceptionBounds(),
    loadTripCounts(feed),
  ]);
  const calendar = new Map<string, Record<string, unknown>>();
  for (const row of feed.table('calendar')) {
    calendar.set(row.service_id, row);
  }
  const ids = [...new Set([...calendar.keys(), ...Object.keys(bounds)])].sort();
  // Same colours as loadServiceData: by index in the sorted id list.
  const color = new Map(ids.map((sid, i) => [sid, getServiceColor(i)]));

  let minDate = '';
  let maxDate = '';
  const widen = (first: string, last: string) => {
    if (first && (minDate === '' || first < minDate)) {
      minDate = first;
    }
    if (last && last > maxDate) {
      maxDate = last;
    }
  };
  const runs = new Map<string, { first: string; last: string }>();
  for (const sid of ids) {
    const cal = calendar.get(sid);
    const ex = bounds[sid];
    let first = cal ? String(cal.start_date) : NO_DATE;
    let last = cal ? String(cal.end_date) : '';
    if (cal) {
      widen(first, last);
    }
    if (ex) {
      widen(ex.first, ex.last);
      if (ex.addedFirst && ex.addedFirst < first) {
        first = ex.addedFirst;
      }
      if (ex.addedLast > last) {
        last = ex.addedLast;
      }
    }
    runs.set(sid, { first, last: last === '' ? NO_DATE : last });
  }
  const order = [...ids].sort((aId, bId) => {
    const a = runs.get(aId)!;
    const b = runs.get(bId)!;
    if (a.first !== b.first) {
      return a.first < b.first ? -1 : 1;
    }
    if (a.last !== b.last) {
      return a.last < b.last ? -1 : 1;
    }
    const diff = (tripCounts.get(bId) ?? 0) - (tripCounts.get(aId) ?? 0);
    return diff !== 0 ? diff : aId < bId ? -1 : aId > bId ? 1 : 0;
  });
  const lo = minDate ? parseGtfsDate(minDate) : null;
  const hi = maxDate ? parseGtfsDate(maxDate) : null;
  return {
    calendar,
    color,
    tripCounts,
    order,
    span: lo && hi ? { minTs: lo.getTime(), maxTs: hi.getTime() } : null,
  };
}

/** The services running on `date`, sorted. */
function activeOnDay(
  index: CalendarIndex,
  exByDate: Map<string, Map<string, Exceptions>>,
  date: string
): string[] {
  const onDay = exByDate.get(date);
  const active: string[] = [];
  const candidates = onDay
    ? new Set([...index.calendar.keys(), ...onDay.keys()])
    : index.calendar.keys();
  for (const sid of candidates) {
    const exceptions = onDay?.get(sid) ?? [];
    if (isServiceActive(index.calendar.get(sid) ?? null, exceptions, date)) {
      active.push(sid);
    }
  }
  return active.sort();
}

/** Chips for `sids` on `date`. */
function renderDayChips(
  index: CalendarIndex,
  exByDate: Map<string, Map<string, Exceptions>>,
  date: string,
  sids: string[]
): string {
  const onDay = exByDate.get(date);
  return sids
    .map((sid) =>
      renderServiceChip(
        sid,
        {
          calendar: index.calendar.get(sid) ?? null,
          exceptions: onDay?.get(sid) ?? [],
          color: index.color.get(sid) ?? '',
          label: sid,
        },
        date
      )
    )
    .join('');
}

export async function showCalendarModal(
  deps: CalendarModalDeps
): Promise<void> {
  const { feed } = deps;
  const bounds = feedBounds(feed);
  const feedStartDate = bounds.start ?? null;
  const feedEndDate = bounds.end ?? null;
  let batchRunning = false;
  let openService: (sid: string) => void = () => {};
  let root: HTMLElement | null = null;
  let redrawModal: () => void = () => {};

  // Loaded as the tabs ask for them; dropped after a batch write.
  let index: CalendarIndex | null = null;
  const monthExceptions = new Map<
    string,
    Map<string, Map<string, Exceptions>>
  >();
  const serviceExceptions = new Map<string, Exceptions>();
  // Services of each day with more than a page of chips, for its lazy list.
  const crowdedDays = new Map<
    string,
    { active: string[]; exByDate: Map<string, Map<string, Exceptions>> }
  >();
  let dayLists: LazyList<string>[] = [];
  let timelineList: LazyList<string> | null = null;
  let timelineNeedle = '';
  const inFlight = new Set<string>();
  // Bumped by a batch write, so a load that started before it is dropped.
  let generation = 0;

  /** Run `load` once per key, then redraw if the modal is still open. */
  const ensure = (key: string, load: () => Promise<void>): void => {
    if (inFlight.has(key)) {
      return;
    }
    inFlight.add(key);
    const t0 = performance.now();
    load()
      .then(() => {
        if (!root?.isConnected) {
          console.log(`[CalendarModal] closed before ${key} landed, dropped`);
          return;
        }
        console.log(
          `[CalendarModal] ${key} loaded in ${Math.round(performance.now() - t0)}ms`
        );
        redrawModal();
      })
      .catch((error: unknown) => {
        console.error(`[CalendarModal] ${key} failed:`, error);
        notify.error(error instanceof Error ? error.message : String(error));
      })
      .finally(() => inFlight.delete(key));
  };

  const needIndex = (): CalendarIndex | null => {
    if (!index) {
      const gen = generation;
      ensure('index', async () => {
        const loaded = await loadCalendarIndex(feed);
        if (gen === generation) {
          index = loaded;
        }
      });
    }
    return index;
  };

  const trimTitle = feedStartDate
    ? t('page.trimAllTitle', { date: feedStartDate })
    : t('page.noFeedStart');
  const extendTitle = feedEndDate
    ? t('page.extendAllTitle', { date: feedEndDate })
    : t('page.noFeedEnd');

  const toolbarHtml = (): string => `
    <button
      type="button"
      class="btn btn-xs btn-outline"
      data-cal-bound="start_date"
      title="${escapeHtml(trimTitle)}"
      ${feedStartDate && !batchRunning ? '' : 'disabled'}
    >${t('page.trimAll')}</button>
    <button
      type="button"
      class="btn btn-xs btn-outline"
      data-cal-bound="end_date"
      title="${escapeHtml(extendTitle)}"
      ${feedEndDate && !batchRunning ? '' : 'disabled'}
    >${t('page.extendAll')}</button>
  `;

  // The grid of `month` (its first day) spans at most 6 weeks around it.
  const gridRange = (month: string): [string, string] => {
    const first = parseGtfsDate(month)!;
    const from = new Date(first.getTime() - 7 * DAY_MS);
    const to = new Date(first.getTime() + 6 * 7 * DAY_MS);
    return [toGtfsDate(from), toGtfsDate(to)];
  };

  const renderGrid = (month: string): string => {
    const idx = needIndex();
    const exByDate = monthExceptions.get(month);
    if (idx && !exByDate) {
      const gen = generation;
      ensure(`month ${month}`, async () => {
        const [from, to] = gridRange(month);
        const rows = await feed.where('calendar_dates', [
          { col: 'date', gt: from },
          { col: 'date', lt: to },
        ]);
        const byDate = new Map<string, Map<string, Exceptions>>();
        for (const row of rows) {
          const day = byDate.get(row.date) ?? new Map<string, Exceptions>();
          byDate.set(row.date, day);
          const list = day.get(row.service_id) ?? [];
          day.set(row.service_id, list);
          list.push(row);
        }
        if (gen === generation) {
          monthExceptions.set(month, byDate);
        }
      });
    }
    crowdedDays.clear();
    if (!idx || !exByDate) {
      return renderModalLoading();
    }
    return renderMonthGrid(month, {
      codec: GTFS_DATE_CODEC,
      weekStart: CONFIG.WEEK_START,
      today: todayGtfsDate,
      renderDay: ({ date }) => {
        const active = activeOnDay(idx, exByDate, date);
        // A crowded day fills its chips a page at a time in `mountLists`.
        if (active.length > CONFIG.CALENDAR_DAY_CHIPS) {
          crowdedDays.set(date, { active, exByDate });
        }
        return {
          badges: renderFeedEdgeBadges(date, feedStartDate, feedEndDate),
          chips:
            active.length > CONFIG.CALENDAR_DAY_CHIPS
              ? `<div data-cal-day-chips="${escapeHtml(date)}" class="flex flex-col gap-0.5"></div>`
              : renderDayChips(idx, exByDate, date, active),
        };
      },
    });
  };

  /** The timeline's search and frame; `mountLists` appends its rows. */
  const renderTimeline = (): string => {
    const idx = needIndex();
    if (!idx) {
      return renderModalLoading();
    }
    if (idx.order.length === 0) {
      return renderNoTimeline('noData');
    }
    if (!idx.span) {
      return renderNoTimeline('noDates');
    }
    const frame = renderServiceTimelineFrame(
      timelineFrame(idx.span, idx.order),
      { tripCounts: idx.tripCounts }
    );
    return `
      <input
        type="search"
        class="input input-sm w-56 mb-2"
        data-cal-timeline-search
        placeholder="${escapeHtml(t('page.filterServices'))}"
        value="${escapeHtml(timelineNeedle)}"
      />
      <div data-cal-timeline>${frame}</div>`;
  };

  /** Exceptions of the services in `sids` not read yet. */
  const loadServiceExceptions = async (sids: string[]): Promise<void> => {
    const missing = sids.filter((sid) => !serviceExceptions.has(sid));
    if (missing.length === 0) {
      return;
    }
    const gen = generation;
    const rows = await feed.where('calendar_dates', [
      { col: 'service_id', in: missing },
    ]);
    if (gen !== generation) {
      return;
    }
    for (const sid of missing) {
      serviceExceptions.set(sid, []);
    }
    for (const row of rows) {
      serviceExceptions.get(row.service_id)?.push(row);
    }
  };

  /** The timeline's lazy rows, against the frame just drawn. */
  const mountTimeline = (tbody: HTMLElement, idx: CalendarIndex): void => {
    const span = idx.span;
    if (!span) {
      return;
    }
    const frame = timelineFrame(span, idx.order);
    const kept = timelineList?.shown() ?? 0;
    timelineList = mountLazyList<string>(tbody, {
      name: 'calendar timeline',
      items: [],
      pageSize: CONFIG.MODAL_LIST_ROWS,
      renderPage: async (slice) => {
        await loadServiceExceptions(slice);
        const entries: Array<[string, ServiceData]> = slice.map((sid) => [
          sid,
          {
            calendar: idx.calendar.get(sid) ?? null,
            exceptions: serviceExceptions.get(sid) ?? [],
            color: idx.color.get(sid) ?? '',
            label: sid,
          },
        ]);
        return renderServiceTimelineRows(frame, entries, {
          tripCounts: idx.tripCounts,
        });
      },
      afterAppend: (nodes) => {
        for (const node of nodes) {
          attachServiceTimelineListeners(node, (sid) => openService(sid));
        }
      },
      match: (sid, needle) => sid.toLowerCase().includes(needle),
      noMatch: (needle) => t('page.noServiceMatch', { filter: needle }),
    });
    timelineList.setNeedle(timelineNeedle);
    timelineList.setItems(idx.order, { through: kept - 1 });
  };

  /** After a redraw: the timeline's rows and each crowded day's chips. */
  const mountLists = (root: HTMLElement): void => {
    for (const list of dayLists) {
      list.destroy();
    }
    dayLists = [];
    const tbody = root.querySelector<HTMLElement>(
      '[data-cal-timeline] [data-timeline-rows]'
    );
    if (!tbody) {
      timelineList?.destroy();
      timelineList = null;
    }
    const idx = index;
    if (!idx) {
      return;
    }
    if (tbody) {
      timelineList?.destroy();
      mountTimeline(tbody, idx);
      const input = root.querySelector<HTMLInputElement>(
        '[data-cal-timeline-search]'
      );
      if (input) {
        bindListSearch(input, (needle) => {
          timelineNeedle = needle;
          timelineList?.setNeedle(needle);
        });
      }
    }
    root
      .querySelectorAll<HTMLElement>('[data-cal-day-chips]')
      .forEach((target) => {
        const date = target.dataset.calDayChips ?? '';
        const day = crowdedDays.get(date);
        if (!day) {
          return;
        }
        dayLists.push(
          mountLazyList<string>(target, {
            name: `calendar day ${date}`,
            items: day.active,
            pageSize: CONFIG.CALENDAR_DAY_CHIPS,
            renderPage: (slice) =>
              renderDayChips(idx, day.exByDate, date, slice),
          })
        );
      });
  };

  const runBoundBatch = async (
    field: 'start_date' | 'end_date',
    value: string
  ): Promise<void> => {
    batchRunning = true;
    redrawModal();
    try {
      const { services, exceptions } = await trimOrExtendServices(
        feed,
        field,
        value
      );
      if (services === 0 && exceptions === 0) {
        notify.info(t('page.alreadyAtBound'));
      } else {
        const vars = {
          services: t('count.services', { count: services }),
          exceptions: t('count.exceptions', { count: exceptions }),
        };
        const trim = field === 'start_date';
        notify.success(
          exceptions > 0
            ? t(trim ? 'page.trimmedRemoved' : 'page.extendedRemoved', vars)
            : t(trim ? 'page.trimmed' : 'page.extended', vars)
        );
      }
      // Every service's calendar and exceptions may have moved.
      generation++;
      inFlight.clear();
      index = null;
      monthExceptions.clear();
      serviceExceptions.clear();
    } finally {
      batchRunning = false;
      redrawModal();
    }
  };

  await showSharedCalendarModal({
    title: t('cal.title'),
    codec: GTFS_DATE_CODEC,
    weekStart: CONFIG.WEEK_START,
    today: todayGtfsDate,
    toolbarHtml,
    tabs: [
      { key: 'month', label: t('cal.monthGrid'), render: renderGrid },
      {
        key: 'timeline',
        label: t('cal.timeline'),
        monthless: true,
        render: renderTimeline,
      },
    ],
    onMount: (handle) => {
      root = handle.root;
      redrawModal = handle.redraw;
      openService = (sid) => {
        handle.close();
        deps.onServiceClick(sid);
      };

      handle.root.addEventListener('click', (event) => {
        const source = event.target as HTMLElement | null;
        const chip = source?.closest<HTMLElement>('.cal-chip');
        if (chip?.dataset.serviceId) {
          openService(chip.dataset.serviceId);
          return;
        }
        const bound = source?.closest<HTMLButtonElement>('[data-cal-bound]');
        if (!bound || bound.disabled) {
          return;
        }
        if (bound.dataset.calBound === 'start_date' && feedStartDate) {
          void runBoundBatch('start_date', feedStartDate);
        } else if (bound.dataset.calBound === 'end_date' && feedEndDate) {
          void runBoundBatch('end_date', feedEndDate);
        }
      });

      console.log('[CalendarModal] opened');
    },
    onRender: mountLists,
  });
}
