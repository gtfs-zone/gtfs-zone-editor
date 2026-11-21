/**
 * Page Content Renderer
 *
 * Unified content rendering system for GTFS.zone Browse tab.
 * Renders appropriate content based on PageState, replacing fragmented
 * rendering logic across multiple modules.
 */

import { PageState } from '../types/page-state';
import {
  StopViewController,
  StopViewDependencies,
} from './stop-view-controller';
import {
  AgencyViewController,
  AgencyViewDependencies,
} from './agency-view-controller';
import {
  ServiceViewController,
  ServiceViewDependencies,
} from './service-view-controller';
import {
  PathwayViewController,
  PathwayViewDependencies,
} from './pathway-view-controller';
import {
  ZoneViewController,
  ZoneViewDependencies,
} from './zone-view-controller';
import {
  LocationGroupViewController,
  LocationGroupViewDependencies,
} from './location-group-view-controller';
import {
  installInlineEditableFields,
  renderInlineEntityFields,
} from '../utils/inline-editable-field';
import { installStopAreasField } from '../utils/stop-areas-field';
import type { EditableTableDeps } from './editable-table';
import {
  attachIssueCard,
  renderIssueCard,
} from 'gtfs-zone-web-common/ui/issue-card';
import { installGuideButtons } from 'gtfs-zone-web-common/ui/help-modal';
import {
  feedIssuesNeedRefresh,
  getFeedIssues,
  refreshFeedIssuesIfStale,
} from './feed-issues';
import { navigateToIssueItem, runFeedIssueAction } from './feed-issues-modal';
import { GTFS_TABLES } from '../types/gtfs';
import { nextEntityId } from '../utils/inline-entity-creator';
import {
  createDefaultAgency,
  createDefaultRoute,
} from '../utils/default-values';
import {
  getAgencyDisplay,
  getEntityDisplay,
  getServiceDisplay,
  getRouteDisplay,
  renderCardLabel,
  renderOptionLabel,
} from '../utils/entity-display';
import {
  showModal,
  renderTrashIcon,
} from 'gtfs-zone-web-common/ui/modal-utils';
import { renderNavIcon } from 'gtfs-zone-web-common/ui/nav-icons';
import { promptNewEntity } from './entity-form-modal';
import { showNewServiceModal } from './new-service-modal';
import { installRenameAction } from '../utils/rename-action';
import { showOptionPickerModal } from './option-picker-modal';
import {
  renderPickerTrigger,
  setPickerTriggerContent,
} from '../utils/picker-trigger';
import { notify } from 'gtfs-zone-web-common/ui/notification-system';
import { escapeHtml } from 'gtfs-zone-web-common/util/escape-html';
import {
  getCurrentPageState,
  navigateToHome,
  navigateToLocationGroup,
  navigateToZone,
} from './navigation-actions';
import type { EditorFeed, FeedRow } from '../feed/editor-feed';
import { deleteOp, insertOp, updateOp } from '../feed/patch-build';
import { renderRouteDiagram, ROUTE_DIAGRAM_ROW } from './route-diagram';
import { getZoneFeatures, zoneFileChange } from './zone-store';
import {
  attachServiceTimelineListeners,
  filterServiceDataMap,
  isServiceActive,
  loadServiceData,
  loadTripCounts,
  renderNoTimeline,
  renderServiceTimeline,
  renderServiceTimelineFrame,
  renderServiceTimelineRows,
  serviceDateBounds,
  sortServiceEntries,
  timelineFrame,
  timelineSpan,
  type ServiceData,
  type TimelineFrame,
} from './service-timeline';
import {
  bindListSearch,
  mountLazyList,
  type LazyList,
} from 'gtfs-zone-web-common/ui/lazy-list';
import { formatGtfsDateRange, todayGtfsDate } from '../utils/gtfs-date';
import { CONFIG } from '../config';
import { normalizeAgencyId } from '../utils/agency-helpers';
import { feedBounds, trimOrExtendServices } from '../utils/feed-bounds';
import {
  renderAgencyReference,
  STOP_REF_ROW,
  PATHWAY_REF_ROW,
  ENTITY_REF_BTN,
  TIMETABLE_REF_ROW,
  VIEW_ROUTE_BTN,
  VIEW_SERVICE_BTN,
} from '../utils/entity-references';
import { introHtml } from '../intro';
import { t } from '../i18n/messages';

/** The home panel's issues section; `data-pending` until validation lands. */
const HOME_ISSUES_ID = 'home-issues';
const HOME_SERVICES_LIST_ID = 'home-services-list';
const HOME_SERVICES_FILTER_ID = 'home-services-filter';

/** The home services list: every service, and what the list shows of it. */
interface HomeServices {
  /** Running today first, then `sortServiceEntries` order. */
  entries: Array<[string, ServiceData]>;
  tripCounts: Map<string, number>;
  /** Null when no service has a date. */
  frame: TimelineFrame | null;
  filter: string;
  /** Rows the last list drew, redrawn after an edit's re-render. */
  shown: number;
  list: LazyList<[string, ServiceData]> | null;
}

/** Marks the route page's network picker. */
const ROUTE_NETWORK_FIELD = 'route-network-field';

/** Sentinel option value for "create a network inline". */
const CREATE_NETWORK = '\0create-network';

/**
 * Interface for injected dependencies
 */
export interface ContentRendererDependencies {
  feed: EditorFeed;

  // Service days controller for calendar editing
  serviceDaysController: {
    renderServiceEditor: (service_id: string) => Promise<string>;
  };

  // Map controller for visualization updates
  mapController: {
    highlightRoute: (route_id: string) => void;
    highlightStop: (stop_id: string) => void;
    highlightPathway: (pathway_id: string) => void;
    highlightZone: (location_id: string) => void;
    highlightLocationGroup: (location_group_id: string) => void;
    hoverStop: (stop_id: string | null) => void;
    hoverTransfer: (
      edge: { from_stop_id: string; to_stop_id: string } | null
    ) => void;
    clearHighlights: () => void;
    focusOnAgency: (agency_id: string) => void;
    refreshStops: () => void;
    refreshZones: () => void;
    focusFeed: () => void;
  };

  // Navigation callbacks
  onAgencyClick: (agency_id: string) => void;
  onRouteClick: (route_id: string) => void;
  onStopClick: (stop_id: string) => void;
  onPathwayClick?: (pathway_id: string) => void;
  onServiceClick?: (service_id: string) => void;
  onTimetableClick: (
    route_id: string,
    service_id: string,
    direction_id?: string
  ) => void;
  onEntityCreated?: () => void;
}

/**
 * Page Content Renderer
 */
export class PageContentRenderer {
  private dependencies: ContentRendererDependencies;
  private stopViewController: StopViewController;
  private agencyViewController: AgencyViewController;
  private serviceViewController: ServiceViewController;
  private pathwayViewController: PathwayViewController;
  private zoneViewController: ZoneViewController;
  private locationGroupViewController: LocationGroupViewController;

  // Time the last focusMap took, folded into the renderHome timing line.
  private lastMapFocusMs = 0;

  // The services list of the last home render, filtered and paged in place.
  private homeServices: HomeServices | null = null;

  constructor(dependencies: ContentRendererDependencies) {
    this.dependencies = dependencies;

    // Initialize StopViewController with current dependencies
    const feed = dependencies.feed;
    const stopViewDependencies: StopViewDependencies = {
      feed,
      onStopClick: dependencies.onStopClick,
      onStopHover: (stop_id) => dependencies.mapController.hoverStop(stop_id),
      onTransferHover: (edge) => dependencies.mapController.hoverTransfer(edge),
      onPathwayClick: dependencies.onPathwayClick,
      onDeleteStop: (stop_id) => this.handleDeleteStop(stop_id),
      onTransfersChanged: () => dependencies.onEntityCreated?.(),
    };
    this.stopViewController = new StopViewController(stopViewDependencies);

    // Initialize PathwayViewController
    const pathwayViewDependencies: PathwayViewDependencies = {
      feed,
      onDeletePathway: (pathway_id) => this.handleDeletePathway(pathway_id),
    };
    this.pathwayViewController = new PathwayViewController(
      pathwayViewDependencies
    );

    // Initialize ZoneViewController (on-demand zones, locations.geojson)
    const zoneViewDependencies: ZoneViewDependencies = {
      feed,
      onRouteClick: dependencies.onRouteClick,
      onGeometryChanged: () => {
        // The page re-render does not touch the map, so refresh the polygons too.
        dependencies.mapController.refreshZones();
        dependencies.onEntityCreated?.();
      },
      onPropertiesChanged: () => {
        // Zone labels are drawn from the feature properties, so the map needs
        // the same refresh a geometry edit gets.
        dependencies.mapController.refreshZones();
        dependencies.onEntityCreated?.();
      },
      onDeleteZone: (location_id) => this.handleDeleteZone(location_id),
    };
    this.zoneViewController = new ZoneViewController(zoneViewDependencies);

    // Initialize LocationGroupViewController
    const locationGroupViewDependencies: LocationGroupViewDependencies = {
      feed,
      onStopClick: dependencies.onStopClick,
      onRouteClick: dependencies.onRouteClick,
      onMembersChanged: () => dependencies.onEntityCreated?.(),
    };
    this.locationGroupViewController = new LocationGroupViewController(
      locationGroupViewDependencies
    );

    // Initialize AgencyViewController with current dependencies
    const agencyViewDependencies: AgencyViewDependencies = {
      feed,
      onRouteClick: dependencies.onRouteClick,
      onDeleteAgency: (agency_id) => this.handleDeleteAgency(agency_id),
    };
    this.agencyViewController = new AgencyViewController(
      agencyViewDependencies
    );

    // Initialize ServiceViewController with current dependencies
    const serviceViewDependencies: ServiceViewDependencies = {
      feed,
      serviceDaysController: dependencies.serviceDaysController,
      onAgencyClick: dependencies.onAgencyClick,
      onRouteClick: dependencies.onRouteClick,
      onTimetableClick: dependencies.onTimetableClick,
      onDeleteService: (service_id) => this.handleDeleteService(service_id),
      onServiceChanged: () => dependencies.onEntityCreated?.(),
    };
    this.serviceViewController = new ServiceViewController(
      serviceViewDependencies
    );

    // Click-to-edit property fields commit straight to the patch log, so they
    // need the same dependencies this renderer holds. Installing here rather
    // than in addEventListeners keeps it to once per renderer, and the fields
    // are rendered before any listener pass runs anyway.
    installInlineEditableFields({ feed });

    // The stop page's area chips write stop_areas.txt.
    installStopAreasField({ feed });

    // ID triggers open the impact modal from wherever they were rendered,
    // including inside a modal, so the listeners are document-level.
    installRenameAction({
      feed,
      onRenamed: () => dependencies.onEntityCreated?.(),
    });
  }

  /** The writing handle an embedded editable table needs. */
  private editableDeps(): EditableTableDeps {
    return { feed: this.dependencies.feed };
  }

  /**
   * Run one issue row's action on that row's group.
   *
   * The button is disabled for the duration rather than left clickable: a
   * second run while the first is in flight would work from entities that
   * have already been rewritten.
   */
  private async runIssueAction(button: HTMLButtonElement): Promise<void> {
    const deps = this.editableDeps();
    const key = button.getAttribute('data-issue-key') ?? '';
    const actionId = button.getAttribute('data-issue-action') ?? '';
    button.disabled = true;
    if (!(await runFeedIssueAction(key, actionId, deps))) {
      button.disabled = false;
      return;
    }
    // Re-render the home panel; the patch moved the feed version, so drawing
    // the issue card revalidates and the fixed rows drop out of it.
    this.dependencies.onEntityCreated?.();
  }

  /**
   * Point the map at whatever the page being rendered is about.
   *
   * Synchronous and up front rather than inside the individual render*
   * methods: those sit behind awaits, so a re-render triggered by an edit
   * could resolve after the user had already navigated elsewhere and drag the
   * map back to the old object. Skipped outright when page state has moved on
   * since this render was requested.
   */
  focusMap(pageState: PageState): void {
    if (!this.dependencies.feed.isOpen) {
      return;
    }
    if (JSON.stringify(getCurrentPageState()) !== JSON.stringify(pageState)) {
      console.log(
        `[PageContentRenderer] stale render for ${pageState.type}, skipping map focus`
      );
      return;
    }

    const map = this.dependencies.mapController;
    switch (pageState.type) {
      case 'agency':
        map.focusOnAgency(pageState.agency_id);
        break;
      case 'route':
        map.highlightRoute(pageState.route_id);
        break;
      case 'stop':
        map.highlightStop(pageState.stop_id);
        break;
      case 'pathway':
        map.highlightPathway(pageState.pathway_id);
        break;
      case 'zone':
        map.highlightZone(pageState.location_id);
        break;
      case 'location_group':
        map.highlightLocationGroup(pageState.location_group_id);
        break;
      default:
        // home and service: no single object to focus, frame the whole feed
        map.focusFeed();
        break;
    }
  }

  /**
   * Main rendering method - renders content based on page state
   * @param pageState - Current page state to render
   * @returns HTML string for the content
   */
  async renderPage(pageState: PageState): Promise<string> {
    const focusStart = performance.now();
    // A camera error must not take the sidebar render down with it.
    try {
      this.focusMap(pageState);
    } catch (error) {
      console.error(
        `[PageContentRenderer] map focus failed for ${pageState.type}:`,
        error
      );
    }
    this.lastMapFocusMs = performance.now() - focusStart;

    try {
      // Render based on page type
      switch (pageState.type) {
        case 'home':
          return await this.renderHome();
        case 'agency':
          return await this.renderAgency(pageState.agency_id);
        case 'route':
          return await this.renderRoute(pageState.route_id);
        case 'stop':
          return await this.renderStop(pageState.stop_id);
        case 'service':
          return await this.renderService(pageState.service_id);
        case 'pathway':
          return await this.renderPathway(pageState.pathway_id);
        case 'zone':
          return await this.renderZone(pageState.location_id);
        case 'location_group':
          return await this.renderLocationGroup(pageState.location_group_id);
        default:
          // TypeScript should prevent this, but fallback to home
          return await this.renderHome();
      }
    } catch (error) {
      console.error('Error rendering page:', error);
      return this.renderError(t('page.loadFailed'));
    }
  }

  /**
   * Render loading state
   */
  renderLoading(): string {
    return `
      <div class="flex items-center justify-center p-8">
        <div class="loading loading-spinner loading-lg"></div>
        <span class="ml-3">Loading...</span>
      </div>
    `;
  }

  /**
   * Render error state
   */
  private renderError(message: string): string {
    return `
      <div class="alert alert-error m-4">
        <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>${message}</span>
      </div>
    `;
  }

  /**
   * A clean feed renders no issue card, which would otherwise leave the home
   * panel with nothing to say about the feed's health. Shown only when the
   * feed has data and zero warnings or errors.
   */
  private renderCleanFeedEncouragement(): string {
    return `
      <div class="rounded-lg border border-success/40 bg-success/10 p-3 text-sm flex items-center justify-between gap-3">
        <span>${t('page.cleanFeed')}</span>
        <button type="button" class="btn btn-xs btn-success btn-outline" data-open-guide="publishing">
          ${t('page.publishingGuide')}
        </button>
      </div>
    `;
  }

  /**
   * Render home page (feed info and agencies list)
   */
  private async renderHome(): Promise<string> {
    const feed = this.dependencies.feed;
    // Fresh boot renders home before any feed is open.
    if (!feed.isOpen) {
      console.log('[PageContentRenderer] renderHome: no feed open');
      this.homeServices = null;
      return `<div class="p-4"><div class="text-center py-6 opacity-70">${t('page.noFeedOpen')}</div></div>`;
    }
    const t0 = performance.now();
    const agencies = feed.table('agency');

    // Get feed_info data
    const feedInfo = this.getFeedInfo();
    const tMeta = performance.now();

    const serviceData = await loadServiceData(feed);
    const serviceCount = serviceData.size;
    const tServices = performance.now();
    const tripCounts = await loadTripCounts(feed);
    const tTripCounts = performance.now();
    const bounds = feedBounds(feed);
    const bulkTrimTitle = bounds.start
      ? t('page.trimAllTitle', { date: bounds.start })
      : t('page.noFeedStart');
    const bulkExtendTitle = bounds.end
      ? t('page.extendAllTitle', { date: bounds.end })
      : t('page.noFeedEnd');

    // Routes without agency_id belong to the agency when there is only one
    const routeCounts = new Map<string, number>();
    for (const route of feed.table('routes')) {
      let agency_id = normalizeAgencyId(route.agency_id);
      if (agency_id === '' && agencies.length === 1) {
        agency_id = normalizeAgencyId(agencies[0].agency_id);
      }
      routeCounts.set(agency_id, (routeCounts.get(agency_id) ?? 0) + 1);
    }
    const agencyItems = agencies
      .map((agency) => ({
        agency,
        count: routeCounts.get(agency.agency_id) ?? 0,
        name: getAgencyDisplay(agency).primary,
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .map(({ agency, count }) => renderAgencyReference(agency, count))
      .join('');

    const tTimelineStart = performance.now();
    const servicesHtml =
      serviceCount === 0
        ? ''
        : this.renderHomeServices(serviceData, tripCounts);
    const tTimeline = performance.now();

    const feedIsEmpty = !Object.values(await feed.read('counts')).some(
      (n) => n > 0
    );
    // Validation of a large feed takes seconds to minutes, so the issues
    // section fills in on its own once the pass lands (fillHomeIssues).
    const issuesPending = feedIssuesNeedRefresh();
    const issuesHtml = issuesPending
      ? `<div class="flex items-center gap-2 text-sm opacity-70"><span class="loading loading-spinner loading-sm"></span>${t('page.issuesChecking')}</div>`
      : this.renderHomeIssues(feedIsEmpty);

    const html = `
      <div class="p-4 space-y-4">
        ${feedIsEmpty ? `<div class="card bg-base-100 shadow-lg"><div class="card-body p-4">${introHtml()}</div></div>` : ''}
        ${await this.renderFeedInfoProperties(feedInfo)}

        <div id="${HOME_ISSUES_ID}" class="space-y-4"${issuesPending ? ` data-pending="${feedIsEmpty ? 'empty' : 'data'}"` : ''}>${issuesHtml}</div>

        <div class="space-y-4">
          <div class="flex items-center justify-between gap-4">
            <h2 class="text-lg font-semibold">${t('page.agencies')}</h2>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="btn btn-sm btn-primary"
                data-entity-create="agency"
              >${t('page.newAgency')}</button>
            </div>
          </div>
          ${
            agencies.length === 0
              ? `<div class="card bg-base-100 shadow-lg">
                  <div class="card-body p-4">
                    <div class="text-center py-6 opacity-70">
                      ${t('page.noAgencies')}
                    </div>
                  </div>
                </div>`
              : `<div class="card bg-base-100 shadow-lg">
                  <div class="card-body p-4">
                    <div class="space-y-2">
                      ${agencyItems}
                    </div>
                  </div>
                </div>`
          }
        </div>

        <div class="space-y-4">
          <div class="flex items-center justify-between gap-4">
            <h2 class="text-lg font-semibold">${t('page.services')}</h2>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="btn btn-xs btn-outline"
                id="bulk-trim-all-btn"
                title="${escapeHtml(bulkTrimTitle)}"
                ${bounds.start ? '' : 'disabled'}
              >${t('page.trimAll')}</button>
              <button
                type="button"
                class="btn btn-xs btn-outline"
                id="bulk-extend-all-btn"
                title="${escapeHtml(bulkExtendTitle)}"
                ${bounds.end ? '' : 'disabled'}
              >${t('page.extendAll')}</button>
              <button
                type="button"
                class="btn btn-sm btn-primary"
                data-entity-create="service"
              >${t('page.newService')}</button>
            </div>
          </div>
          ${
            serviceCount === 0
              ? `<div class="card bg-base-100 shadow-lg">
                  <div class="card-body p-4">
                    <div class="text-center py-6 opacity-70">
                      ${t('page.noServices')}
                    </div>
                  </div>
                </div>`
              : `<div class="card bg-base-100 shadow-lg">
                  <div class="card-body p-4">
                    ${servicesHtml}
                  </div>
                </div>`
          }
        </div>

      </div>
    `;

    console.log(
      `[PageContentRenderer] renderHome: ` +
        `meta=${Math.round(tMeta - t0)}ms ` +
        `services=${Math.round(tServices - tMeta)}ms ` +
        `tripCounts=${Math.round(tTripCounts - tServices)}ms ` +
        `timeline=${Math.round(tTimeline - tTimelineStart)}ms ` +
        `mapFocus=${Math.round(this.lastMapFocusMs)}ms ` +
        `total=${Math.round(performance.now() - t0)}ms ` +
        `services=${serviceCount} agencies=${agencies.length} ` +
        `issues=${issuesPending ? 'pending' : 'current'} ` +
        `html=${Math.round(html.length / 1024)}kb`
    );

    return html;
  }

  /** The issue card, or the clean-feed note when there is nothing to fix. */
  private renderHomeIssues(feedIsEmpty: boolean): string {
    const feedIssues = getFeedIssues();
    // Only worth encouraging export once there is something to export, and
    // nothing left to clean up first.
    const clean = !feedIsEmpty && feedIssues.every((row) => row.count === 0);
    return `
      ${renderIssueCard(t('page.feedIssues'), feedIssues)}
      ${clean ? this.renderCleanFeedEncouragement() : ''}
    `;
  }

  /**
   * Fill a pending home issues section once validation has caught up with the
   * feed. A section the page has since re-rendered away is left alone: its
   * replacement fills itself.
   */
  private async fillHomeIssues(slot: HTMLElement): Promise<void> {
    const feedIsEmpty = slot.dataset.pending === 'empty';
    try {
      // A pass discarded because the feed moved on leaves the issues stale.
      do {
        await refreshFeedIssuesIfStale();
      } while (slot.isConnected && feedIssuesNeedRefresh());
    } catch (error) {
      console.error('[PageContentRenderer] home issues failed:', error);
      if (slot.isConnected) {
        slot.innerHTML = this.renderError(t('page.loadFailed'));
      }
      return;
    }
    if (!slot.isConnected) {
      console.log('[PageContentRenderer] home re-rendered before its issues');
      return;
    }
    slot.innerHTML = this.renderHomeIssues(feedIsEmpty);
    delete slot.dataset.pending;
    installGuideButtons(slot);
    this.attachIssueCardListeners(slot);
    console.log('[PageContentRenderer] home issues filled in');
  }

  /**
   * The services summary, filter and the timeline frame whose rows
   * `attachHomeServicesListeners` appends a page at a time.
   */
  private renderHomeServices(
    data: Map<string, ServiceData>,
    tripCounts: Map<string, number>
  ): string {
    const today = todayGtfsDate();
    const sorted = sortServiceEntries(data, tripCounts);
    const active = sorted.filter(([, sd]) =>
      isServiceActive(sd.calendar, sd.exceptions, today)
    );
    const activeIds = new Set(active.map(([sid]) => sid));
    const entries = [
      ...active,
      ...sorted.filter(([sid]) => !activeIds.has(sid)),
    ];

    let first = '';
    let last = '';
    for (const [, sd] of entries) {
      const b = serviceDateBounds(sd);
      if (b.first !== '99999999' && (first === '' || b.first < first)) {
        first = b.first;
      }
      if (b.last !== '99999999' && b.last > last) {
        last = b.last;
      }
    }

    // A filter typed before an edit's re-render carries over to the new list,
    // and so do the rows it had drawn.
    const previous = this.homeServices;
    previous?.list?.destroy();
    const span = timelineSpan(data);
    this.homeServices = {
      entries,
      tripCounts,
      frame: span ? timelineFrame(span, data.keys()) : null,
      filter: previous?.filter ?? '',
      shown: previous?.list?.shown() ?? previous?.shown ?? 0,
      list: null,
    };

    const summary = [
      t('count.services', { count: entries.length }),
      t('page.servicesActiveToday', { count: active.length }),
      ...(first && last ? [formatGtfsDateRange(first, last)] : []),
    ].join(', ');

    const timeline =
      entries.length === 0
        ? renderNoTimeline('noData')
        : this.homeServices.frame
          ? renderServiceTimelineFrame(this.homeServices.frame, {
              tripCounts,
              scrollRows: true,
            })
          : renderNoTimeline('noDates');

    return `
      <div class="space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="text-sm opacity-70">${escapeHtml(summary)}</div>
          <input
            type="search"
            id="${HOME_SERVICES_FILTER_ID}"
            class="input input-sm w-56"
            placeholder="${escapeHtml(t('page.filterServices'))}"
            value="${escapeHtml(this.homeServices.filter)}"
          />
        </div>
        <div id="${HOME_SERVICES_LIST_ID}">${timeline}</div>
      </div>
    `;
  }

  /** The home services lazy list and its filter, after a home render. */
  private attachHomeServicesListeners(container: HTMLElement): void {
    const state = this.homeServices;
    const tbody = container.querySelector<HTMLElement>(
      `#${HOME_SERVICES_LIST_ID} [data-timeline-rows]`
    );
    const input = container.querySelector<HTMLInputElement>(
      `#${HOME_SERVICES_FILTER_ID}`
    );
    if (!state?.frame || !tbody || !input) {
      return;
    }
    const frame = state.frame;
    const list = mountLazyList<[string, ServiceData]>(tbody, {
      name: 'home services',
      items: [],
      pageSize: CONFIG.MODAL_LIST_ROWS,
      renderPage: (slice) =>
        renderServiceTimelineRows(frame, slice, {
          tripCounts: state.tripCounts,
        }),
      afterAppend: (nodes) => {
        for (const node of nodes) {
          attachServiceTimelineListeners(node, (service_id) => {
            this.dependencies.onServiceClick?.(service_id);
          });
        }
      },
      match: ([sid], needle) => sid.toLowerCase().includes(needle),
      noMatch: (needle) => t('page.noServiceMatch', { filter: needle }),
    });
    state.list = list;
    list.setNeedle(state.filter);
    list.setItems(state.entries, { through: state.shown - 1 });
    bindListSearch(input, (needle) => {
      state.filter = needle;
      list.setNeedle(needle);
    });
  }

  /**
   * Get feed_info data
   */
  private getFeedInfo(): Record<string, unknown> {
    return this.dependencies.feed.table('feed_info')[0] ?? {};
  }

  /**
   * Render feed_info properties section
   */
  private async renderFeedInfoProperties(
    feedInfo: Record<string, unknown>
  ): Promise<string> {
    // feed_info holds a single row with no primary key of its own, so its
    // patches are keyed by the table name, matching generateCompositeKeyFromRecord.
    const fieldsHtml = await renderInlineEntityFields(
      GTFS_TABLES.FEED_INFO,
      feedInfo as Record<string, string | number | undefined>,
      'feed_info'
    );

    return `
      <div class="space-y-4">
        <h2 class="text-lg font-semibold">${t('page.feedInfo')}</h2>
        <div class="card bg-base-100 shadow-lg">
          <div class="card-body p-4">
            <div class="max-w-md">
              ${fieldsHtml}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render agency page (agency properties and routes list)
   */
  private async renderAgency(agency_id: string): Promise<string> {
    // Use the new AgencyViewController for comprehensive agency view
    return await this.agencyViewController.renderAgencyView(agency_id);
  }

  /**
   * Render route page (route properties + services list)
   */
  private async renderRoute(route_id: string): Promise<string> {
    const feed = this.dependencies.feed;
    const trips = await feed.find('trips', 'route_id', route_id);

    // Fetch route data for the header
    const routeData: Record<string, string> = feed.byKey(
      'routes',
      route_id
    ) ?? {
      route_id,
    };

    // Group trips by service_id for service list
    const serviceGroups: Record<string, FeedRow[]> = {};
    for (const trip of trips) {
      (serviceGroups[trip.service_id] ??= []).push(trip);
    }

    // network_id is not edited here: network membership is held in
    // route_networks.txt and only written back onto routes.txt at export.
    const fieldsHtml = await renderInlineEntityFields(
      GTFS_TABLES.ROUTES,
      routeData,
      route_id,
      ['network_id']
    );
    const networkFieldHtml = await this.renderRouteNetworkField(route_id);

    // Get all available services from calendar, then merge in calendar_dates-only services
    const allServices: Record<string, unknown>[] = [...feed.table('calendar')];
    const calendarServiceIds = new Set(
      allServices.map((s) => s.service_id as string)
    );
    for (const sid of await feed.distinct('calendar_dates', 'service_id')) {
      if (!calendarServiceIds.has(sid)) {
        calendarServiceIds.add(sid);
        allServices.push({ service_id: sid });
      }
    }

    // Which timetable the header button opens: the first service this route
    // runs, falling back to the feed's first service for a route with no trips
    // yet, which opens the empty "add the first trip" timetable.
    const timetableServiceId =
      Object.keys(serviceGroups)[0] ??
      (allServices[0]?.service_id as string | undefined);

    // Render route properties section
    const routePropertiesHTML = `
      <div class="space-y-4">
        <div class="flex items-center justify-between gap-2 min-w-0">
          <h2 class="text-lg font-semibold truncate">${renderCardLabel(getRouteDisplay(routeData))}</h2>
          <div class="flex items-center gap-2 shrink-0">
            <button class="btn btn-sm btn-outline open-timetable-btn" data-route-id="${route_id}" data-service-id="${escapeHtml(timetableServiceId ?? '')}" title="${t('page.timetable')}"${timetableServiceId ? '' : ' disabled'}>${renderNavIcon('timetable', { sizeClass: 'h-4 w-4' })}</button>
            <button class="btn btn-sm btn-error btn-outline delete-route-btn" data-route-id="${route_id}" title="${t('common.delete')}">${renderTrashIcon()}</button>
          </div>
        </div>
        <div class="card bg-base-100 shadow-lg">
          <div class="card-body p-4">
            <div class="max-w-md space-y-3">
              ${fieldsHtml}
              ${networkFieldHtml}
            </div>
          </div>
        </div>
      </div>
    `;

    // Render new service selector, disabled while there are no services
    const noServices = allServices.length === 0;
    const newServiceSelectorHTML = `
      <div class="space-y-2">
        <label class="label" for="new-service-select">
          ${t('page.addTimetable')}
        </label>
        <select
          id="new-service-select"
          class="select select-bordered w-full"
          data-route-id="${route_id}"
          ${noServices ? `disabled title="${t('page.noServicesYet')}"` : ''}
        >
          <option value="">${t('page.chooseService')}</option>
          ${allServices
            .filter((s) => !serviceGroups[s.service_id as string]) // Only show services without trips
            .map(
              (service) => `
              <option value="${service.service_id}">${renderOptionLabel(getServiceDisplay(service as Record<string, string>))}</option>
            `
            )
            .join('')}
          <option value="" data-new-service>${t('page.newServiceOption')}</option>
        </select>
      </div>
    `;

    // Timeline scoped to the services this route actually runs. The fixed
    // route context makes a row click land on that route's timetable.
    const routeServiceData = filterServiceDataMap(
      await loadServiceData(feed, Object.keys(serviceGroups)),
      Object.keys(serviceGroups)
    );

    // Trips of this route only, straight off the grouping above.
    const routeTripCounts = new Map<string, number>(
      Object.entries(serviceGroups).map(([sid, group]) => [sid, group.length])
    );

    // Render timetables list
    const servicesListHTML = `
      <div class="space-y-4">
        <h2 class="text-lg font-semibold">${t('page.timetables')}</h2>
        <div class="card bg-base-100 shadow-lg">
          <div class="card-body p-4">
            ${newServiceSelectorHTML}
            ${
              Object.keys(serviceGroups).length === 0 && noServices
                ? `<div class="text-center py-6 opacity-70">
                    ${t('page.noServicesFound')}
                    <button type="button" class="link link-primary create-service-link">${t('page.createOne')}</button>.
                  </div>`
                : Object.keys(serviceGroups).length === 0
                  ? `<div class="text-center py-6 opacity-70 mt-4">
                    ${t('page.noTimetables')}
                  </div>`
                  : `<div class="mt-4">
                    ${renderServiceTimeline(routeServiceData, { route_id, tripCounts: routeTripCounts })}
                  </div>`
            }
          </div>
        </div>
      </div>
    `;

    // Covers every trip of the route, not one service, so branches that only a
    // few timetables run are visible from the route page.
    const diagramHTML = await renderRouteDiagram(feed, routeData);

    return `
      <div class="p-4 space-y-4">
        ${routePropertiesHTML}
        ${servicesListHTML}
        ${diagramHTML}
      </div>
    `;
  }

  /**
   * Render stop page
   */
  private async renderStop(stop_id: string): Promise<string> {
    // Use the new StopViewController for comprehensive stop view
    return await this.stopViewController.renderStopView(stop_id);
  }

  /**
   * Render service page
   */
  private async renderService(service_id: string): Promise<string> {
    // Use the new ServiceViewController for comprehensive service view
    return await this.serviceViewController.renderServiceView(service_id);
  }

  /**
   * Add event listeners for interactive elements
   * This should be called after the content is inserted into the DOM
   */
  /**
   * The route's network, as a click-to-edit field over `route_networks.txt`.
   *
   * Not a `routes.network_id` editor: the database always holds membership in
   * the canonical tables, and a route may belong to at most one network, which
   * is why this is one value rather than a list.
   */
  private async renderRouteNetworkField(route_id: string): Promise<string> {
    const assignment = this.dependencies.feed.byKey('route_networks', route_id);
    const network_id = assignment?.network_id ?? '';
    const label = network_id === '' ? '' : this.networkLabel(network_id);

    return `
      <fieldset class="fieldset">
        <legend class="fieldset-legend">${t('page.network')}</legend>
        ${renderPickerTrigger({
          content: label
            ? escapeHtml(label)
            : `<span class="opacity-40">${t('page.notInNetwork')}</span>`,
          // Brings its own bordered field box, so only the layout and the
          // chevron come from the shared trigger.
          variant: 'bare',
          className: `${ROUTE_NETWORK_FIELD} w-full cursor-pointer rounded-field border border-base-300 px-3 py-1.5 text-sm hover:bg-base-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary`,
          attrs: `tabindex="0" role="button" data-route-id="${escapeHtml(route_id)}" data-network-id="${escapeHtml(network_id)}"`,
        })}
      </fieldset>
    `;
  }

  /** A network's display label, falling back to the raw id. */
  private networkLabel(network_id: string): string {
    const row = this.dependencies.feed.byKey('networks', network_id);
    return row
      ? renderOptionLabel(getEntityDisplay('networks', row))
      : network_id;
  }

  /**
   * Move a route into a network, out of one, or into a network created on the
   * spot. `route_networks` is keyed on `route_id`, so replacing the row is all
   * that is needed to keep a route in at most one network.
   */
  private async pickRouteNetwork(span: HTMLElement): Promise<void> {
    const route_id = span.dataset.routeId ?? '';
    const current = span.dataset.networkId ?? '';
    if (route_id === '') {
      return;
    }

    const networks = this.dependencies.feed.table('networks');
    const picked = await showOptionPickerModal({
      title: t('page.selectNetwork'),
      options: [
        { value: '', primary: t('common.noneOption') },
        ...networks.map((n) => ({
          value: String(n.network_id ?? ''),
          primary: renderOptionLabel(getEntityDisplay('networks', n)),
          secondary: String(n.network_id ?? ''),
        })),
        { value: CREATE_NETWORK, primary: t('page.createNetwork') },
      ],
      selectedValue: current,
      searchable: true,
    });
    if (picked === null) {
      return;
    }

    let network_id = picked;
    if (picked === CREATE_NETWORK) {
      const created = await this.createNetwork();
      if (created === null) {
        return;
      }
      network_id = created;
    }
    if (network_id === current) {
      return;
    }

    const feed = this.dependencies.feed;
    const existing = feed.byKey('route_networks', route_id);

    if (network_id === '') {
      if (existing) {
        console.log(`[Networks] unassign route ${route_id}`);
        await feed.apply([deleteOp('route_networks', existing)]);
      }
    } else if (existing) {
      console.log(`[Networks] move route ${route_id} to ${network_id}`);
      await feed.apply([updateOp('route_networks', existing, { network_id })]);
    } else {
      console.log(`[Networks] assign route ${route_id} to ${network_id}`);
      await feed.apply([insertOp('route_networks', { network_id, route_id })]);
    }

    span.dataset.networkId = network_id;
    setPickerTriggerContent(
      span,
      network_id === ''
        ? `<span class="opacity-40">${t('page.notInNetwork')}</span>`
        : escapeHtml(this.networkLabel(network_id))
    );
  }

  /**
   * Ask for a new network's ID and name and write it. Returns its ID.
   */
  private async createNetwork(): Promise<string | null> {
    const feed = this.dependencies.feed;
    let network_id: string | null = null;
    const values = await promptNewEntity({
      title: t('page.newNetwork'),
      id: {
        table: 'networks',
        suggested: await nextEntityId(feed, 'networks', 'network'),
      },
      fields: [
        {
          field: 'network_name',
          tableName: GTFS_TABLES.NETWORKS,
          note: t('page.networkNote'),
        },
      ],
      validate: () => null,
      onCreate: async (v) => {
        const id = v.network_id;
        await feed.apply([
          insertOp('networks', {
            network_id: id,
            network_name: v.network_name,
          }),
        ]);
        network_id = id;
        console.log(`[Networks] created ${id}`);
      },
    });

    return values ? network_id : null;
  }

  /** The feed issue card's item lists, item links and row actions. */
  private attachIssueCardListeners(root: HTMLElement): void {
    // Each row mounts its lazy item list when opened, from the rows the card
    // was just rendered from.
    attachIssueCard(root, getFeedIssues());

    // Feed issue card items: navigate to the offending object's own page.
    // Delegated per list, since pages of items are appended on scroll.
    root.querySelectorAll('[data-issue-list]').forEach((list) => {
      list.addEventListener('click', (event) => {
        const item = (event.target as Element).closest('[data-issue-nav]');
        if (item) {
          navigateToIssueItem(item);
        }
      });
    });

    // Feed issue card row actions: a fix for that row's group only.
    root.querySelectorAll('[data-issue-action]').forEach((button) => {
      button.addEventListener('click', (event) => {
        // The button sits inside a <summary>, which would otherwise toggle.
        event.preventDefault();
        event.stopPropagation();
        void this.runIssueAction(button as HTMLButtonElement);
      });
    });
  }

  addEventListeners(container: HTMLElement): void {
    // Clean-feed encouragement's link into the publishing guide.
    installGuideButtons(container);

    // Agency card clicks
    const agencyCards = container.querySelectorAll('.agency-card');
    agencyCards.forEach((card) => {
      card.addEventListener('click', () => {
        const agency_id = card.getAttribute('data-agency-id');
        if (agency_id !== null) {
          this.dependencies.onAgencyClick(agency_id);
        }
      });
    });

    // Route card clicks
    const routeCards = container.querySelectorAll('.route-card');
    routeCards.forEach((card) => {
      card.addEventListener('click', () => {
        const route_id = card.getAttribute('data-route-id');
        if (route_id) {
          this.dependencies.onRouteClick(route_id);
        }
      });
    });

    // Timeline row clicks go to the timetable (route page, which supplies a
    // route context) or to the service page (home page, which does not)
    attachServiceTimelineListeners(container, (service_id, route_id) => {
      if (route_id) {
        this.dependencies.onTimetableClick(route_id, service_id);
      } else {
        this.dependencies.onServiceClick?.(service_id);
      }
    });

    // Timetable rows: the row opens the timetable, the buttons branch off to
    // either half of the route/service pair.
    container.querySelectorAll(`.${TIMETABLE_REF_ROW}`).forEach((row) => {
      row.addEventListener('click', () => {
        const route_id = row.getAttribute('data-route-id');
        const service_id = row.getAttribute('data-service-id');
        if (route_id && service_id) {
          this.dependencies.onTimetableClick(route_id, service_id);
        }
      });
    });
    container.querySelectorAll(`.${VIEW_ROUTE_BTN}`).forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const route_id = btn.getAttribute('data-route-id');
        if (route_id) {
          this.dependencies.onRouteClick(route_id);
        }
      });
    });
    container.querySelectorAll(`.${VIEW_SERVICE_BTN}`).forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const service_id = btn.getAttribute('data-service-id');
        if (service_id && this.dependencies.onServiceClick) {
          this.dependencies.onServiceClick(service_id);
        }
      });
    });

    // "View ..." button clicks: handles stops and services
    const entityRefBtns = container.querySelectorAll(`.${ENTITY_REF_BTN}`);
    entityRefBtns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const stop_id = btn.getAttribute('data-stop-id');
        if (stop_id) {
          this.dependencies.onStopClick(stop_id);
          return;
        }
        const service_id = btn.getAttribute('data-service-id');
        if (service_id && this.dependencies.onServiceClick) {
          this.dependencies.onServiceClick(service_id);
        }
      });
    });

    // Stop reference row clicks go to stop page
    const stopRefRows = container.querySelectorAll(`.${STOP_REF_ROW}`);
    stopRefRows.forEach((row) => {
      row.addEventListener('click', () => {
        const stop_id = row.getAttribute('data-stop-id');
        if (stop_id) {
          this.dependencies.onStopClick(stop_id);
        }
      });
    });

    // Route diagram rows go to the stop page, or to the zone / location group
    // page for a flex row. The flex navigations are imported directly rather
    // than added to ContentRendererDependencies: they take no renderer state,
    // and it is how schedule-controller already navigates.
    container.querySelectorAll(`.${ROUTE_DIAGRAM_ROW}`).forEach((row) => {
      row.addEventListener('click', () => {
        const stop_id = row.getAttribute('data-stop-id');
        if (stop_id) {
          this.dependencies.onStopClick(stop_id);
          return;
        }
        const flex_id = row.getAttribute('data-flex-id');
        if (flex_id) {
          if (row.getAttribute('data-flex-kind') === 'location_group') {
            void navigateToLocationGroup(flex_id);
          } else {
            void navigateToZone(flex_id);
          }
        }
      });
    });

    // Pathway reference row clicks go to pathway page
    const pathwayRefRows = container.querySelectorAll(`.${PATHWAY_REF_ROW}`);
    pathwayRefRows.forEach((row) => {
      row.addEventListener('click', () => {
        const pathway_id = row.getAttribute('data-pathway-id');
        if (pathway_id && this.dependencies.onPathwayClick) {
          this.dependencies.onPathwayClick(pathway_id);
        }
      });
    });

    this.attachIssueCardListeners(container);
    this.attachHomeServicesListeners(container);

    // The home issues section renders before validation and fills in after.
    const issuesSlot = container.querySelector<HTMLElement>(
      `#${HOME_ISSUES_ID}[data-pending]`
    );
    if (issuesSlot) {
      void this.fillHomeIssues(issuesSlot);
    }

    // Route header timetable button
    const openTimetableBtn = container.querySelector('.open-timetable-btn');
    if (openTimetableBtn) {
      openTimetableBtn.addEventListener('click', () => {
        const route_id = openTimetableBtn.getAttribute('data-route-id');
        const service_id = openTimetableBtn.getAttribute('data-service-id');
        if (route_id && service_id) {
          this.dependencies.onTimetableClick(route_id, service_id);
        }
      });
    }

    // Delete route button
    const deleteRouteBtn = container.querySelector('.delete-route-btn');
    if (deleteRouteBtn) {
      deleteRouteBtn.addEventListener('click', () => {
        const route_id = deleteRouteBtn.getAttribute('data-route-id');
        if (route_id) {
          this.handleDeleteRoute(route_id);
        }
      });
    }

    // Add StopViewController event listeners
    // It will only attach to stop fields (data-table="stops.txt")
    this.stopViewController.addEventListeners(container);

    // Add PathwayViewController event listeners
    this.pathwayViewController.addEventListeners(container);

    // Add zone and location group event listeners
    this.zoneViewController.addEventListeners(container);
    this.locationGroupViewController.addEventListeners(container);

    // Add AgencyViewController event listeners
    // It will only attach to agency fields (data-table="agency.txt")
    this.agencyViewController.addEventListeners(container);

    // Add ServiceViewController event listeners
    // It will only attach to service-related elements
    this.serviceViewController.addEventListeners(container);

    // Bulk trim/extend all services to feed_info bounds
    container
      .querySelector('#bulk-trim-all-btn')
      ?.addEventListener('click', () => {
        void this.handleBulkTrimOrExtend('start_date');
      });
    container
      .querySelector('#bulk-extend-all-btn')
      ?.addEventListener('click', () => {
        void this.handleBulkTrimOrExtend('end_date');
      });

    // Add entity creation event listeners
    this.addEntityCreationListeners(container);

    // Add service selection dropdown listener
    this.addServiceSelectionListener(container);

    // "No services found" empty state: create one here rather than sending the
    // user to the Feed page's inline input.
    container
      .querySelector('.create-service-link')
      ?.addEventListener('click', () => {
        void this.createServiceFromEmptyState();
      });

    // Route network field: same activation contract as the click-to-edit
    // property fields, so it is reachable by Tab and opens on Enter or Space.
    container.querySelectorAll(`.${ROUTE_NETWORK_FIELD}`).forEach((span) => {
      span.addEventListener('click', () => {
        void this.pickRouteNetwork(span as HTMLElement);
      });
      span.addEventListener('keydown', (e) => {
        const key = (e as KeyboardEvent).key;
        if (key === 'Enter' || key === ' ') {
          e.preventDefault();
          void this.pickRouteNetwork(span as HTMLElement);
        }
      });
    });
  }

  /** Create a service from the route page's "no services" empty state. */
  private async createServiceFromEmptyState(): Promise<void> {
    const service_id = await showNewServiceModal(this.dependencies.feed);
    if (service_id !== null) {
      this.dependencies.onEntityCreated?.();
    }
  }

  /** Create a service from the route page's service select, then open its timetable. */
  private async createServiceForRoute(routeId: string): Promise<void> {
    const service_id = await showNewServiceModal(this.dependencies.feed);
    if (service_id === null) {
      return;
    }
    console.log(
      `[PageContentRenderer] Created service ${service_id} for route ${routeId}`
    );
    this.dependencies.onTimetableClick(routeId, service_id);
  }

  /**
   * Add event listeners for the "+" buttons on the entity lists
   */
  private addEntityCreationListeners(container: HTMLElement): void {
    container
      .querySelectorAll<HTMLElement>('[data-entity-create]')
      .forEach((button) => {
        const entityType = button.dataset.entityCreate;
        button.addEventListener('click', () => {
          void this.createEntity(entityType, button);
        });
      });
  }

  /**
   * Create the entity behind a "+" button and open its page
   */
  private async createEntity(
    entityType: string | undefined,
    button: HTMLElement
  ): Promise<void> {
    if (entityType === 'agency') {
      const agency_id = await this.createAgency();
      if (agency_id) {
        this.dependencies.onEntityCreated?.();
        this.dependencies.onAgencyClick(agency_id);
      }
      return;
    }

    if (entityType === 'service') {
      const service_id = await showNewServiceModal(this.dependencies.feed);
      if (service_id !== null) {
        this.dependencies.onEntityCreated?.();
        this.dependencies.onServiceClick?.(service_id);
      }
      return;
    }

    if (entityType === 'route') {
      const route_id = await this.createRoute(
        button.dataset.agencyId || undefined
      );
      if (route_id) {
        this.dependencies.onEntityCreated?.();
        this.dependencies.onRouteClick(route_id);
      }
      return;
    }

    console.warn(
      `[PageContentRenderer] unknown data-entity-create value: ${entityType}`
    );
  }

  /**
   * Ask for a new agency's ID and write a default agency under it. Returns
   * its ID, or null when cancelled.
   */
  private async createAgency(): Promise<string | null> {
    const feed = this.dependencies.feed;
    let agency_id: string | null = null;
    const values = await promptNewEntity({
      title: t('page.newAgencyTitle'),
      id: {
        table: 'agency',
        suggested: await nextEntityId(feed, 'agency', 'agency'),
      },
      fields: [],
      validate: () => null,
      onCreate: async (v) => {
        const agencies = feed.table('agency');
        const record = createDefaultAgency(
          v.agency_id,
          agencies[0]?.agency_timezone ?? ''
        );
        await feed.apply([insertOp('agency', record)]);
        agency_id = v.agency_id;
        console.log(`[PageContentRenderer] created agency ${agency_id}`);
      },
    });

    return values ? agency_id : null;
  }

  /**
   * Ask for a new route's ID and write a default route under it, on the given
   * agency or the first one. Returns its ID, or null when cancelled.
   */
  private async createRoute(agencyId?: string): Promise<string | null> {
    const feed = this.dependencies.feed;
    let route_id: string | null = null;
    const values = await promptNewEntity({
      title: t('page.newRouteTitle'),
      id: {
        table: 'routes',
        suggested: await nextEntityId(feed, 'routes', 'route'),
      },
      fields: [],
      validate: () => null,
      onCreate: async (v) => {
        const agency = agencyId || feed.table('agency')[0]?.agency_id;
        const record = createDefaultRoute(v.route_id, agency || undefined);
        await feed.apply([insertOp('routes', record)]);
        route_id = v.route_id;
        console.log(
          `[PageContentRenderer] created route ${route_id} on agency ${agency ?? '(none)'}`
        );
      },
    });

    return values ? route_id : null;
  }

  /**
   * Trim or extend every `calendar` row's bound to the matching `feed_info`
   * value and drop the exceptions past that edge, as one undoable batch.
   * Mirrors the Service Calendar modal's bulk buttons so the feed page has the
   * same action.
   */
  private async handleBulkTrimOrExtend(
    field: 'start_date' | 'end_date'
  ): Promise<void> {
    const feed = this.dependencies.feed;
    const bounds = feedBounds(feed);
    const value = field === 'start_date' ? bounds.start : bounds.end;
    if (!value) {
      return;
    }
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
    this.dependencies.onEntityCreated?.();
  }

  /**
   * Add event listener for service selection dropdown
   */
  private addServiceSelectionListener(container: HTMLElement): void {
    const serviceSelect = container.querySelector(
      '#new-service-select'
    ) as HTMLSelectElement;
    if (!serviceSelect) {
      return;
    }

    serviceSelect.addEventListener('change', () => {
      const selectedServiceId = serviceSelect.value;
      const routeId = serviceSelect.getAttribute('data-route-id');
      if (!routeId) {
        return;
      }

      if (serviceSelect.selectedOptions[0]?.hasAttribute('data-new-service')) {
        // A focused select takes focus back from the modal's ID editor,
        // which commits and closes it.
        serviceSelect.value = '';
        serviceSelect.blur();
        void this.createServiceForRoute(routeId);
        return;
      }

      if (!selectedServiceId) {
        return;
      }

      // Navigate directly to timetable view
      this.dependencies.onTimetableClick(routeId, selectedServiceId);

      // Reset the dropdown
      serviceSelect.value = '';
    });
  }

  /** The stop_times of the given trips. */
  private async stopTimesOf(
    trips: readonly Record<string, unknown>[]
  ): Promise<FeedRow[]> {
    if (trips.length === 0) {
      return [];
    }
    return this.dependencies.feed.where('stop_times', [
      { col: 'trip_id', in: trips.map((trip) => String(trip.trip_id)) },
    ]);
  }

  private async handleDeleteRoute(route_id: string): Promise<void> {
    console.log(
      '[PageContentRenderer] handleDeleteRoute called, route_id:',
      route_id
    );
    const feed = this.dependencies.feed;
    const route = feed.byKey('routes', route_id);
    if (!route) {
      console.warn(
        '[PageContentRenderer] handleDeleteRoute: route not found for id',
        route_id
      );
      return;
    }

    const trips = await feed.find('trips', 'route_id', route_id);
    const allStopTimes = await this.stopTimesOf(trips);

    const doDelete = async () => {
      const deleteOps = [
        ...allStopTimes.map((st) => deleteOp('stop_times', st)),
        ...trips.map((trip) => deleteOp('trips', trip)),
        deleteOp('routes', route),
      ];
      const label =
        trips.length === 0
          ? t('delete.route')
          : t('delete.cascade', {
              label: t('delete.route'),
              parts: [
                t('count.trips', { count: trips.length }),
                t('count.stopTimes', { count: allStopTimes.length }),
              ].join(' + '),
            });
      await feed.apply(deleteOps, label);

      console.log(
        `[PageContentRenderer] Deleted route ${route_id} + ${trips.length} trips + ${allStopTimes.length} stop_times`
      );
      await navigateToHome();
    };

    if (trips.length === 0) {
      await showModal({
        title: t('page.deleteRouteTitle'),
        body: `<p>${t('page.deleteRouteEmpty')}</p>`,
        enterAction: 1,
        escapeAction: 0,
        actions: [
          {
            label: t('common.cancel'),
            className: 'btn-ghost',
            onClick: () => {},
          },
          {
            label: t('delete.route'),
            className: 'btn-error',
            onClick: doDelete,
          },
        ],
      });
      return;
    }

    await showModal({
      title: t('page.routeHasTrips'),
      body: `<p>${t('page.routeHasTripsBody', {
        trips: `<strong>${t('count.trips', { count: trips.length })}</strong>`,
        stopTimes: `<strong>${t('count.stopTimes', { count: allStopTimes.length })}</strong>`,
      })}</p>
             <p class="mt-3">${t('page.routeCascade')}</p>`,
      enterAction: 1,
      escapeAction: 0,
      actions: [
        {
          label: t('common.cancel'),
          className: 'btn-ghost',
          onClick: () => {},
        },
        {
          label: t('delete.cascade', {
            label: t('delete.route'),
            parts: [
              t('count.trips', { count: trips.length }),
              t('count.stopTimes', { count: allStopTimes.length }),
            ].join(' + '),
          }),
          className: 'btn-error',
          onClick: doDelete,
        },
      ],
    });
  }

  private async handleDeleteService(service_id: string): Promise<void> {
    console.log(
      '[PageContentRenderer] handleDeleteService called, service_id:',
      service_id
    );
    const feed = this.dependencies.feed;
    const trips = await feed.find('trips', 'service_id', service_id);
    const allStopTimes = await this.stopTimesOf(trips);
    const calendarDates = await feed.find(
      'calendar_dates',
      'service_id',
      service_id
    );
    const calendarRow = feed.byKey('calendar', service_id);

    const doDelete = async () => {
      const deleteOps = [
        ...allStopTimes.map((st) => deleteOp('stop_times', st)),
        ...trips.map((trip) => deleteOp('trips', trip)),
        ...calendarDates.map((cd) => deleteOp('calendar_dates', cd)),
        ...(calendarRow ? [deleteOp('calendar', calendarRow)] : []),
      ];

      const parts = serviceDependentParts();
      const label =
        parts.length === 0
          ? t('delete.service')
          : t('delete.cascade', {
              label: t('delete.service'),
              parts: parts.join(' + '),
            });
      await feed.apply(deleteOps, label);

      console.log(
        `[PageContentRenderer] Deleted service ${service_id} + ${trips.length} trips + ${allStopTimes.length} stop_times + ${calendarDates.length} calendar_dates`
      );
      await navigateToHome();
    };

    // The non-empty counts among a service's dependents, worded.
    function serviceDependentParts(): string[] {
      return [
        trips.length > 0 ? t('count.trips', { count: trips.length }) : '',
        allStopTimes.length > 0
          ? t('count.stopTimes', { count: allStopTimes.length })
          : '',
        calendarDates.length > 0
          ? t('count.calendarDates', { count: calendarDates.length })
          : '',
      ].filter((part) => part !== '');
    }

    const hasAnyDependents = trips.length > 0 || calendarDates.length > 0;

    if (!hasAnyDependents) {
      await showModal({
        title: t('page.deleteServiceTitle'),
        body: `<p>${t('page.deleteServiceEmpty')}</p>`,
        enterAction: 1,
        escapeAction: 0,
        actions: [
          {
            label: t('common.cancel'),
            className: 'btn-ghost',
            onClick: () => {},
          },
          {
            label: t('delete.service'),
            className: 'btn-error',
            onClick: doDelete,
          },
        ],
      });
      return;
    }

    const dependentParts = serviceDependentParts();

    await showModal({
      title: t('page.serviceHasDependents'),
      body: `<p>${t('page.serviceHasBody', {
        parts: dependentParts
          .map((part) => `<strong>${part}</strong>`)
          .join(', '),
      })}</p>
             <p class="mt-3">${t('page.serviceCascade')}</p>`,
      enterAction: 1,
      escapeAction: 0,
      actions: [
        {
          label: t('common.cancel'),
          className: 'btn-ghost',
          onClick: () => {},
        },
        {
          label: t('delete.cascade', {
            label: t('delete.service'),
            parts: dependentParts.join(' + '),
          }),
          className: 'btn-error',
          onClick: doDelete,
        },
      ],
    });
  }

  private async handleDeleteAgency(agency_id: string): Promise<void> {
    console.log(
      '[PageContentRenderer] handleDeleteAgency called, agency_id:',
      agency_id
    );
    const feed = this.dependencies.feed;
    const agency = feed.byKey('agency', agency_id);
    if (!agency) {
      console.warn(
        '[PageContentRenderer] handleDeleteAgency: agency not found for id',
        agency_id
      );
      return;
    }

    const routes = feed
      .table('routes')
      .filter((route) => route.agency_id === agency_id);
    const allTrips =
      routes.length > 0
        ? await feed.where('trips', [
            { col: 'route_id', in: routes.map((r) => r.route_id) },
          ])
        : [];
    const allStopTimes = await this.stopTimesOf(allTrips);
    const agencyParts = (): string[] => [
      t('count.routes', { count: routes.length }),
      t('count.trips', { count: allTrips.length }),
      t('count.stopTimes', { count: allStopTimes.length }),
    ];

    const doDelete = async () => {
      const deleteOps = [
        ...allStopTimes.map((st) => deleteOp('stop_times', st)),
        ...allTrips.map((trip) => deleteOp('trips', trip)),
        ...routes.map((route) => deleteOp('routes', route)),
        deleteOp('agency', agency),
      ];

      const label =
        routes.length === 0
          ? t('delete.agency')
          : t('delete.cascade', {
              label: t('delete.agency'),
              parts: agencyParts().join(' + '),
            });
      await feed.apply(deleteOps, label);

      console.log(
        `[PageContentRenderer] Deleted agency ${agency_id} + ${routes.length} routes + ${allTrips.length} trips + ${allStopTimes.length} stop_times`
      );
      await navigateToHome();
    };

    if (routes.length === 0) {
      await showModal({
        title: t('page.deleteAgencyTitle'),
        body: `<p>${t('page.deleteAgencyEmpty')}</p>`,
        enterAction: 1,
        escapeAction: 0,
        actions: [
          {
            label: t('common.cancel'),
            className: 'btn-ghost',
            onClick: () => {},
          },
          {
            label: t('delete.agency'),
            className: 'btn-error',
            onClick: doDelete,
          },
        ],
      });
      return;
    }

    await showModal({
      title: t('page.agencyHasRoutes'),
      body: `<p>${t('page.agencyHasBody', {
        routes: `<strong>${t('count.routes', { count: routes.length })}</strong>`,
        trips: `<strong>${t('count.trips', { count: allTrips.length })}</strong>`,
        stopTimes: `<strong>${t('count.stopTimes', { count: allStopTimes.length })}</strong>`,
      })}</p>
             <p class="mt-3">${t('page.agencyCascade')}</p>`,
      enterAction: 1,
      escapeAction: 0,
      actions: [
        {
          label: t('common.cancel'),
          className: 'btn-ghost',
          onClick: () => {},
        },
        {
          label: t('delete.cascade', {
            label: t('delete.agency'),
            parts: agencyParts().join(' + '),
          }),
          className: 'btn-error',
          onClick: doDelete,
        },
      ],
    });
  }

  private async handleDeleteStop(stop_id: string): Promise<void> {
    console.log(
      '[PageContentRenderer] handleDeleteStop called, stop_id:',
      stop_id
    );
    const feed = this.dependencies.feed;
    const stop = feed.byKey('stops', stop_id);
    if (!stop) {
      console.warn(
        '[PageContentRenderer] handleDeleteStop: stop not found for id',
        stop_id
      );
      return;
    }

    const stopTimes = await feed.where('stop_times', [
      { col: 'stop_id', eq: stop_id },
    ]);

    const doDelete = async (cascade: boolean) => {
      // One patch: one undo step, one notification.
      const deleteOps = [
        ...(cascade ? stopTimes.map((st) => deleteOp('stop_times', st)) : []),
        deleteOp('stops', stop),
      ];
      const label = cascade
        ? t('delete.cascade', {
            label: t('delete.stop'),
            parts: t('count.stopTimes', { count: stopTimes.length }),
          })
        : t('delete.stop');
      await feed.apply(deleteOps, label);

      console.log(
        `[PageContentRenderer] Deleted stop ${stop_id}${cascade ? ` and ${stopTimes.length} stop_times` : ''}`
      );
      this.dependencies.mapController.refreshStops();
      await navigateToHome();
    };

    if (stopTimes.length === 0) {
      await doDelete(false);
      return;
    }

    const tripIds = [...new Set(stopTimes.map((st) => st.trip_id as string))];
    const tripSummary =
      tripIds.slice(0, 5).join(', ') +
      (tripIds.length > 5
        ? t('delete.andMore', { count: tripIds.length - 5 })
        : '');
    await showModal({
      title: t('page.stopHasVisits'),
      body: `<p>${t('page.stopReferenced', {
        stopTimes: `<strong>${t('count.stopTimes', { count: stopTimes.length })}</strong>`,
        trips: t('count.trips', { count: tripIds.length }),
      })}</p>
             <p class="text-sm opacity-70 mt-1">${tripSummary}</p>
             <p class="mt-3">${t('page.stopCascade')}</p>`,
      enterAction: 1,
      escapeAction: 0,
      actions: [
        {
          label: t('common.cancel'),
          className: 'btn-ghost',
          onClick: () => {},
        },
        {
          label: t('delete.cascade', {
            label: t('delete.stop'),
            parts: t('count.stopTimes', { count: stopTimes.length }),
          }),
          className: 'btn-error',
          onClick: () => doDelete(true),
        },
      ],
    });
  }

  private async renderPathway(pathway_id: string): Promise<string> {
    return this.pathwayViewController.renderPathwayView(pathway_id);
  }

  private async renderZone(location_id: string): Promise<string> {
    return this.zoneViewController.renderZoneView(location_id);
  }

  private async renderLocationGroup(
    location_group_id: string
  ): Promise<string> {
    return this.locationGroupViewController.renderLocationGroupView(
      location_group_id
    );
  }

  /**
   * Remove a zone from locations.geojson, cascading to the stop_times that
   * reference it.
   *
   * The feature removal is an update of the single locations row, not a row
   * delete, so the cascade goes through recordBatchMixed: the stop_time deletes
   * and that update land as one patch and undo restores them together.
   */
  private async handleDeleteZone(location_id: string): Promise<void> {
    const feed = this.dependencies.feed;
    const features = getZoneFeatures(feed);
    if (!features.some((f) => String(f.id ?? '') === location_id)) {
      console.warn(
        `[PageContentRenderer] handleDeleteZone: zone ${location_id} not in locations.geojson`
      );
      return;
    }

    const stopTimes = await feed.where('stop_times', [
      { col: 'location_id', eq: location_id },
    ]);

    const doDelete = async (): Promise<void> => {
      await feed.apply(
        stopTimes.map((st) => deleteOp('stop_times', st)),
        stopTimes.length > 0
          ? t('delete.cascade', {
              label: t('delete.zone'),
              parts: t('count.stopTimes', { count: stopTimes.length }),
            })
          : t('delete.zone'),
        undefined,
        [
          zoneFileChange(
            feed,
            features.filter((f) => String(f.id ?? '') !== location_id)
          ),
        ]
      );

      console.log(
        `[PageContentRenderer] Deleted zone ${location_id}${stopTimes.length > 0 ? ` and ${stopTimes.length} stop_times` : ''}`
      );
      this.dependencies.mapController.refreshZones();
      await navigateToHome();
    };

    if (stopTimes.length === 0) {
      await doDelete();
      return;
    }

    const tripIds = [...new Set(stopTimes.map((st) => st.trip_id as string))];
    const tripSummary =
      tripIds.slice(0, 5).join(', ') +
      (tripIds.length > 5
        ? t('delete.andMore', { count: tripIds.length - 5 })
        : '');
    await showModal({
      title: t('page.zoneHasPickups'),
      body: `<p>${t('page.zoneReferenced', {
        stopTimes: `<strong>${t('count.stopTimes', { count: stopTimes.length })}</strong>`,
        trips: t('count.trips', { count: tripIds.length }),
      })}</p>
             <p class="text-sm opacity-70 mt-1">${tripSummary}</p>
             <p class="mt-3">${t('page.zoneCascade')}</p>`,
      enterAction: 1,
      escapeAction: 0,
      actions: [
        {
          label: t('common.cancel'),
          className: 'btn-ghost',
          onClick: () => {},
        },
        {
          label: t('delete.cascade', {
            label: t('delete.zone'),
            parts: t('count.stopTimes', { count: stopTimes.length }),
          }),
          className: 'btn-error',
          onClick: () => doDelete(),
        },
      ],
    });
  }

  private async handleDeletePathway(pathway_id: string): Promise<void> {
    const feed = this.dependencies.feed;
    const pathway = feed.byKey('pathways', pathway_id);
    if (!pathway) {
      return;
    }

    await feed.apply([deleteOp('pathways', pathway)]);

    console.log(`[PageContentRenderer] Deleted pathway ${pathway_id}`);
    await navigateToHome();
  }
}
