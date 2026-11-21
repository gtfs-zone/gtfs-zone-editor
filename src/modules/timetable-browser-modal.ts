/**
 * Timetable Browser Modal
 *
 * Every timetable of the feed at a glance: one collapsible section per agency,
 * a table of that agency's routes against the services they run, with the
 * trip count of each (route, service) pair in its cell. A section with too
 * many services lists each route's timetables instead. A section renders when
 * first opened, appending a page of rows as it scrolls. One search filters the
 * routes of every section and hides the sections left empty.
 *
 * A cell opens that timetable. The timetable is a different modal type, so the
 * router closes this one when the page state switches to it.
 */

import { showModal } from 'gtfs-zone-web-common/ui/modal-utils';
import { escapeHtml } from 'gtfs-zone-web-common/util/escape-html';
import { routeColor } from 'gtfs-zone-web-common/gtfs/route-colors';
import { routeSortKey } from 'gtfs-zone-web-common/gtfs/route-sort';
import { SELECTED_ROW_CLASS } from 'gtfs-zone-web-common/ui/selectable-row';
import type { EditorFeed } from '../feed/editor-feed';
import type { ScheduleController } from './schedule-controller';
import { openTimetable } from './navigation-actions';
import {
  getAgencyDisplay,
  getRouteDisplay,
  getServiceDisplay,
  renderCardLabel,
  renderOptionLabel,
} from '../utils/entity-display';
import { formatDaysOfWeek } from '../utils/entity-references';
import { t } from '../i18n/messages';
import { formatNumber } from 'gtfs-zone-web-common/i18n/fmt';
import { CONFIG } from '../config';
import { renderModalLoading } from '../utils/modal-loading';
import {
  bindListSearch,
  mountLazyList,
  type LazyList,
} from 'gtfs-zone-web-common/ui/lazy-list';

export interface TimetableBrowserDeps {
  feed: EditorFeed;
  scheduleController: ScheduleController;
}

type Row = Record<string, string>;

interface AgencySection {
  /** Null for the routes whose agency_id resolves to no agency. */
  agency: Row | null;
  routes: Row[];
}

/**
 * Group routes by agency. A route without agency_id belongs to the only
 * agency of a single-agency feed; any other route whose agency_id names no
 * agency lands in the "No agency" section.
 */
function groupByAgency(agencies: Row[], routes: Row[]): AgencySection[] {
  const byId = new Map<string, AgencySection>();
  for (const agency of agencies) {
    byId.set(agency.agency_id ?? '', { agency, routes: [] });
  }
  const orphans: AgencySection = { agency: null, routes: [] };
  const soleAgency = agencies.length === 1 ? agencies[0] : null;

  for (const route of routes) {
    const agency_id = route.agency_id ?? '';
    const section =
      byId.get(agency_id) ??
      (agency_id === '' && soleAgency
        ? byId.get(soleAgency.agency_id ?? '')
        : undefined);
    if (section) {
      section.routes.push(route);
    } else {
      console.warn(
        `[TimetableBrowser] route ${route.route_id} has agency_id "${agency_id}", which names no agency`
      );
      orphans.routes.push(route);
    }
  }

  const sections = [...byId.values()].sort(
    (a, b) =>
      b.routes.length - a.routes.length ||
      getAgencyDisplay(a.agency!).primary.localeCompare(
        getAgencyDisplay(b.agency!).primary
      )
  );
  if (orphans.routes.length > 0) {
    sections.push(orphans);
  }
  return sections;
}

/** A section with its routes sorted and its service columns picked. */
interface SectionView {
  section: AgencySection;
  routes: Row[];
  /** Services these routes run, busiest first. */
  columns: string[];
  /** False when there are too many columns: each row lists its timetables. */
  matrix: boolean;
  /** Lowercased route_id and names, per route, for the search. */
  searchText: Map<Row, string>;
  /** Mounted once the section is first opened. */
  list: LazyList<Row> | null;
}

interface BrowserData {
  /** service_id -> trip count, per route. */
  perRoute: Map<string, Map<string, number>>;
  routeTripCounts: Map<string, number>;
  currentRouteId: string | null;
  feed: EditorFeed;
  /** calendar rows looked up so far; a calendar_dates-only service keeps an id-only record. */
  services: Map<string, Row>;
}

function service(data: BrowserData, service_id: string): Row {
  let row = data.services.get(service_id);
  if (!row) {
    row = (data.feed.byKey('calendar', service_id) as Row | null) ?? {
      service_id,
    };
    data.services.set(service_id, row);
  }
  return row;
}

function buildSectionView(
  section: AgencySection,
  data: BrowserData
): SectionView {
  const routes = section.routes
    .map((route) => ({
      route,
      label: getRouteDisplay(route).primary,
      key: routeSortKey(
        route.route_type,
        data.routeTripCounts.get(route.route_id ?? '') ?? 0
      ),
    }))
    .sort((a, b) => b.key - a.key || a.label.localeCompare(b.label))
    .map(({ route }) => route);

  const serviceTotals = new Map<string, number>();
  for (const route of routes) {
    for (const [service_id, n] of data.perRoute.get(route.route_id ?? '') ??
      []) {
      serviceTotals.set(service_id, (serviceTotals.get(service_id) ?? 0) + n);
    }
  }
  const columns = [...serviceTotals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([service_id]) => service_id);

  return {
    section,
    routes,
    columns,
    matrix: columns.length <= CONFIG.TIMETABLE_BROWSER_MAX_COLUMNS,
    searchText: new Map(
      routes.map((route) => [
        route,
        [route.route_id, route.route_short_name, route.route_long_name]
          .filter(Boolean)
          .join(' ')
          .toLowerCase(),
      ])
    ),
    list: null,
  };
}

function renderServiceLabel(row: Row): string {
  return `<div class="font-semibold">${escapeHtml(renderOptionLabel(getServiceDisplay(row)))}</div>
    <div class="text-xs font-normal opacity-60">${escapeHtml(formatDaysOfWeek(row))}</div>`;
}

function renderTimetableButton(
  route_id: string,
  service_id: string,
  count: number,
  label: string
): string {
  return `<button type="button" class="btn btn-xs btn-ghost" data-route-id="${escapeHtml(route_id)}" data-service-id="${escapeHtml(service_id)}" title="${t('tt.openTimetable')}">${label}${formatNumber(count)}</button>`;
}

function renderRow(view: SectionView, route: Row, data: BrowserData): string {
  const route_id = route.route_id ?? '';
  const color = routeColor(route_id, route.route_color);
  const isCurrent = route_id === data.currentRouteId;
  const selected = isCurrent ? SELECTED_ROW_CLASS : '';
  // The sticky cell needs an opaque background, or scrolled cells show
  // through it.
  const stickyBg = isCurrent ? 'bg-base-200' : 'bg-base-100';
  const routeCell = `<th class="sticky left-0 z-10 ${stickyBg} font-normal">
    <div class="flex items-center gap-2 min-w-40">
      <span class="w-3 h-3 rounded-full flex-shrink-0" style="background-color: ${escapeHtml(color)}"></span>
      ${renderCardLabel(getRouteDisplay(route))}
    </div>
  </th>`;

  const perService = data.perRoute.get(route_id);
  if (!perService || perService.size === 0) {
    return `<tr class="${selected}">${routeCell}<td colspan="${view.matrix ? Math.max(1, view.columns.length) : 1}">
      <button type="button" class="btn btn-xs btn-primary" data-new-timetable data-route-id="${escapeHtml(route_id)}">${t('tt.newTimetable')}</button>
    </td></tr>`;
  }

  if (!view.matrix) {
    const buttons = [...perService.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([service_id, count]) =>
        renderTimetableButton(
          route_id,
          service_id,
          count,
          `${escapeHtml(renderOptionLabel(getServiceDisplay(service(data, service_id))))}: `
        )
      )
      .join('');
    return `<tr class="${selected}">${routeCell}<td><div class="flex flex-wrap gap-1">${buttons}</div></td></tr>`;
  }

  const cells = view.columns
    .map((service_id) => {
      const count = perService.get(service_id) ?? 0;
      if (count === 0) {
        return '<td class="text-center opacity-40">-</td>';
      }
      return `<td class="text-center">${renderTimetableButton(route_id, service_id, count, '')}</td>`;
    })
    .join('');
  return `<tr class="${selected}">${routeCell}${cells}</tr>`;
}

/** The section's table with an empty body for its lazy rows. */
function renderSectionBody(view: SectionView, data: BrowserData): string {
  if (view.routes.length === 0) {
    return `<p class="text-sm opacity-70">${t('tt.noRoutes')}</p>`;
  }
  const headers = view.matrix
    ? view.columns
        .map(
          (service_id) =>
            `<th class="text-center align-bottom">${renderServiceLabel(service(data, service_id))}</th>`
        )
        .join('')
    : `<th>${t('tt.service')}</th>`;
  return `
    <div class="overflow-x-auto">
      <table class="table table-sm w-auto">
        <thead>
          <tr><th class="sticky left-0 z-10 bg-base-100">${t('tt.route')}</th>${headers}</tr>
        </thead>
        <tbody data-section-rows></tbody>
      </table>
    </div>`;
}

/** Collapsed section: its table renders when it is first opened. */
function renderSectionShell(
  view: SectionView,
  index: number,
  open: boolean
): string {
  const title = view.section.agency
    ? renderCardLabel(getAgencyDisplay(view.section.agency))
    : `<span>${t('tt.noAgency')}</span>`;
  return `
    <details class="space-y-2" data-section="${index}"${open ? ' open' : ''}>
      <summary class="cursor-pointer flex items-center gap-2 font-semibold">
        ${title}
        <span class="badge badge-outline badge-sm">${t('count.routes', { count: view.routes.length })}</span>
        <span class="badge badge-outline badge-sm">${t('count.services', { count: view.columns.length })}</span>
      </summary>
      <div data-section-body></div>
    </details>`;
}

/** Fill a section's body and mount its rows the first time it is open. */
function fillSection(
  details: HTMLDetailsElement,
  view: SectionView,
  data: BrowserData,
  needle: string
): void {
  const body = details.querySelector<HTMLElement>('[data-section-body]');
  if (!details.open || !body || body.childElementCount > 0) {
    return;
  }
  body.innerHTML = renderSectionBody(view, data);
  const tbody = body.querySelector<HTMLElement>('[data-section-rows]');
  if (!tbody) {
    return;
  }
  view.list = mountLazyList<Row>(tbody, {
    name: `timetable section ${details.dataset.section}`,
    items: view.routes,
    pageSize: CONFIG.MODAL_LIST_ROWS,
    renderPage: (slice) =>
      slice.map((route) => renderRow(view, route, data)).join(''),
    match: (route, value) =>
      view.searchText.get(route)?.includes(value) ?? false,
  });
  view.list.setNeedle(needle);
  console.log(
    `[TimetableBrowser] section ${details.dataset.section} opened: ` +
      `${view.routes.length} routes, ${view.columns.length} services, ` +
      `${view.matrix ? 'matrix' : 'list'}`
  );
}

/** Load the counts and draw the section shells into `root`. */
async function fillBrowser(
  root: HTMLElement,
  feed: EditorFeed,
  currentRouteId: string | null
): Promise<void> {
  const t0 = performance.now();
  const agencies = feed.table('agency') as Row[];
  const routes = feed.table('routes') as Row[];
  if (routes.length === 0) {
    root.innerHTML = `<p class="opacity-70">${t('tt.feedNoRoutes')}</p>`;
    return;
  }
  const counts = await feed.countBy2('trips', 'route_id', 'service_id');
  if (!root.isConnected) {
    console.log('[TimetableBrowser] closed before counts landed, dropped');
    return;
  }

  const perRoute = new Map<string, Map<string, number>>();
  const routeTripCounts = new Map<string, number>();
  let timetables = 0;
  for (const [route_id, perService] of Object.entries(counts)) {
    const m = new Map<string, number>();
    let total = 0;
    for (const [service_id, n] of Object.entries(perService)) {
      m.set(service_id, n);
      total += n;
    }
    perRoute.set(route_id, m);
    routeTripCounts.set(route_id, total);
    timetables += m.size;
  }
  const data: BrowserData = {
    perRoute,
    routeTripCounts,
    currentRouteId,
    feed,
    services: new Map(),
  };

  const views = groupByAgency(agencies, routes).map((section) =>
    buildSectionView(section, data)
  );
  // Open the section holding the current route, else the first.
  const currentIndex = views.findIndex((view) =>
    view.routes.some((route) => route.route_id === currentRouteId)
  );
  const openIndex = currentIndex === -1 ? 0 : currentIndex;

  root.innerHTML = `
    <div class="flex items-center gap-3">
      <input type="search" class="input input-sm w-64" data-browser-search
        placeholder="${escapeHtml(t('tt.searchRoutes'))}" />
      <span class="text-sm opacity-70" data-browser-no-match hidden></span>
    </div>
    <div class="scroll-rows space-y-6">
      ${views.map((view, i) => renderSectionShell(view, i, i === openIndex)).join('')}
    </div>`;

  let needle = '';
  const sections = [
    ...root.querySelectorAll<HTMLDetailsElement>('details[data-section]'),
  ];
  for (const details of sections) {
    const view = views[Number(details.dataset.section)];
    details.addEventListener('toggle', () =>
      fillSection(details, view, data, needle)
    );
    fillSection(details, view, data, needle);
  }

  const input = root.querySelector<HTMLInputElement>('[data-browser-search]');
  const noMatch = root.querySelector<HTMLElement>('[data-browser-no-match]');
  if (input) {
    bindListSearch(input, (value) => {
      needle = value.trim().toLowerCase();
      let visible = 0;
      for (const details of sections) {
        const view = views[Number(details.dataset.section)];
        const matches = needle
          ? view.routes.filter((route) =>
              view.searchText.get(route)?.includes(needle)
            ).length
          : view.routes.length;
        details.hidden = needle !== '' && matches === 0;
        visible += details.hidden ? 0 : 1;
        view.list?.setNeedle(needle);
      }
      if (noMatch) {
        noMatch.hidden = visible > 0;
        noMatch.textContent = t('tt.noRouteMatch', { filter: value.trim() });
      }
      console.log(`[TimetableBrowser] search "${needle}": ${visible} sections`);
    });
  }

  console.log(
    `[TimetableBrowser] ${views.length} sections, ${routes.length} routes, ` +
      `${timetables} timetables in ${Math.round(performance.now() - t0)}ms`
  );
}

/**
 * Open the timetable browser and resolve once it closes. `currentRouteId` is
 * the route page the browser was opened from, if any; its row is highlighted.
 */
export async function showTimetableBrowserModal(
  deps: TimetableBrowserDeps,
  currentRouteId: string | null
): Promise<void> {
  await showModal({
    title: t('tt.browserTitle'),
    body: `<div id="timetable-browser" class="space-y-6">${renderModalLoading()}</div>`,
    actions: [{ label: t('common.close'), onClick: () => {} }],
    escapeAction: 0,
    boxClassName: 'max-w-6xl',
    onMount: () => {
      const root = document.getElementById('timetable-browser');
      if (!root) {
        return;
      }
      root.addEventListener('click', (event) => {
        const target = event.target as Element;
        const create = target.closest<HTMLElement>('[data-new-timetable]');
        if (create) {
          const route_id = create.dataset.routeId ?? '';
          console.log(`[TimetableBrowser] new timetable for route ${route_id}`);
          void deps.scheduleController.pickTimetableService(route_id);
          return;
        }
        const cell = target.closest<HTMLElement>('[data-service-id]');
        if (cell) {
          const route_id = cell.dataset.routeId ?? '';
          const service_id = cell.dataset.serviceId ?? '';
          console.log(
            `[TimetableBrowser] opening timetable ${route_id} / ${service_id}`
          );
          void openTimetable(route_id, service_id);
        }
      });
      fillBrowser(root, deps.feed, currentRouteId).catch((error: unknown) => {
        console.error('[TimetableBrowser] load failed:', error);
        root.innerHTML = `<div class="alert alert-error">${escapeHtml(error instanceof Error ? error.message : String(error))}</div>`;
      });
    },
  });
}
