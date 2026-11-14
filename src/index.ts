// Mounts the shell markup; must stay the first import.
import './shell';
import { applyZodLocale } from './i18n/zod-locale';
import { MapController } from './modules/map-controller';
import { Editor } from './modules/editor';
import { UIController } from './modules/ui';
import { BottomSheetController } from 'gtfs-zone-web-common/ui/bottom-sheet';
import { BrowseNavigation } from './modules/browse-navigation';
import { SearchController } from 'gtfs-zone-web-common/ui/search-controller';
import {
  buildSearchGroups,
  type SearchPayload,
} from './modules/search-entries';
import { searchPlaces } from 'gtfs-zone-web-common/map/place-search';
import { GTFSValidator } from './modules/gtfs-validator';
import {
  refreshFeedIssuesIfStale,
  setFeedIssueRevalidator,
} from './modules/feed-issues';
import { showFeedIssuesModal } from './modules/feed-issues-modal';
import {
  KeyboardShortcuts,
  describeShortcuts,
  type ShortcutCommand,
} from 'gtfs-zone-web-common/ui/keyboard-shortcuts';
import { ScheduleController } from './modules/schedule-controller';
import { ServiceDaysController } from './modules/service-days-controller';
import { ThemeController } from 'gtfs-zone-web-common/ui/theme-controller';
import { notify } from 'gtfs-zone-web-common/ui/notification-system';
import {
  initializePageStateWithGTFS,
  takeLoadCommand,
} from './modules/page-state-integration';
import { PageStateManager } from './modules/page-state-manager';
import { openModal } from './modules/navigation-actions';
import {
  createModalRouter,
  getModalRouter,
} from 'gtfs-zone-web-common/ui/modal-router';
import { editorShortcuts } from './modules/shortcut-list';
import { showModal } from 'gtfs-zone-web-common/ui/modal-utils';
import { showTimetableModal } from './modules/timetable-modal';
import { showTimetableBrowserModal } from './modules/timetable-browser-modal';
import type { ModalState, PageState } from './types/page-state';
import { HistoryController } from './modules/history-controller';
import { TabLockController } from './modules/tab-lock';
import { humanLabel } from './utils/patch-label';
import { bindExtensionColumns } from './utils/extension-fields';
import { bindFeedActiveRange } from './utils/feed-active-range';
import { runWhenIdle } from './utils/run-when-idle';
import {
  setHelpPages,
  showHelpModal,
  showHelpPageOnce,
} from 'gtfs-zone-web-common/ui/help-modal';
import {
  HELP_GROUP_ORDER,
  setHelpRuntimeData,
} from 'gtfs-zone-web-common/ui/help-pages';
import { HELP_PAGES } from './modules/help-pages';
import { showFaresModal } from './modules/fares-modal';
import { showTranslationsModal } from './modules/translations-modal';
import { showTransfersModal } from './modules/transfers-modal';
import { showAttributionsModal } from './modules/attributions-modal';
import { showOnDemandModal } from './modules/on-demand-modal';
import {
  getZoneFeatures,
  writeZoneFeatures,
  type ZoneFeature,
} from './modules/zone-store';
import { showCalendarModal } from './modules/calendar-modal';
import { ShapesManager } from './modules/shapes-manager';
import { DOCK_ICONS, NAVBAR_ACTIONS } from './modules/navbar-action-list';
import {
  renderDockIcons,
  renderNavbarActions,
} from 'gtfs-zone-web-common/ui/navbar-actions';
import { renderAutoZoomControl } from 'gtfs-zone-web-common/map/auto-zoom';
import { NavbarCounts } from './modules/navbar-counts';
import {
  PanelResizer,
  restorePanelWidth,
} from 'gtfs-zone-web-common/ui/panel-resizer';
import { LevelsController } from './modules/levels-controller';
import { feedProgressIndicator } from 'gtfs-zone-web-common/ui/progress-indicator';
import { databaseFallbackManager } from './modules/database-fallback-manager';
import { LoadCancelledError } from 'gtfs-zone-web-common/gtfs/feed-download';
import { CONFIG } from './config';
import {
  routeColor,
  setFeedRouteColors,
} from 'gtfs-zone-web-common/gtfs/route-colors';
import { initFieldTooltipPortal } from 'gtfs-zone-web-common/util/tooltip-position';
import { configureSpecMarkup } from 'gtfs-zone-web-common/gtfs/spec-markup';
import twoLegSvg from './assets/gtfs-spec/2-leg.svg';
import threeLegSvg from './assets/gtfs-spec/3-leg.svg';
import inliningSvg from './assets/gtfs-spec/inlining.svg';
import './styles/main.css';
import { t } from './i18n/messages';
import { EditorFeed } from './feed/editor-feed';
import {
  createEmptyFeed,
  loadFeed,
  recoverStoredFeedExport,
  restoreFeed,
} from './feed/feed-loader';
import { batch, deleteOp, insertOp, updateOp } from './feed/patch-build';
import { resetFeedStorage } from './feed/feed-boot';
import { RouteRefsIndex } from './feed/route-refs';
import { deleteDatabaseWithTimeout } from './utils/idb-request';

// Reference anchors resolve against the schedule reference, and the three
// diagrams it embeds are bundled here.
configureSpecMarkup({
  referenceUrl: 'https://gtfs.org/documentation/schedule/reference/',
  images: {
    '2-leg.svg': twoLegSvg,
    '3-leg.svg': threeLegSvg,
    'inlining.svg': inliningSvg,
  },
});

applyZodLocale();

declare global {
  interface Window {
    gtfsEditor: GTFSEditor;
    /** Dev builds: the feed and its loaders, for the console and harnesses. */
    __feed?: unknown;
  }
  const __APP_VERSION__: string;
}

/**
 * What boot did about a feed. Explicit because only 'nothing-stored' may be
 * followed by creating an empty feed: that commits a new generation and clears
 * the patch log, so guessing from a row count destroys a stored feed whenever a
 * restore or a load failed.
 */
type BootOutcome =
  'restored' | 'created-empty' | 'loaded' | 'nothing-stored' | 'failed';

export class GTFSEditor {
  public feed = new EditorFeed();
  public routeRefs = new RouteRefsIndex(this.feed);
  public mapController: MapController;
  public editor: Editor;
  public uiController: UIController;
  public browseNavigation: BrowseNavigation;
  public searchController: SearchController<SearchPayload>;
  public validator: GTFSValidator;
  public keyboardShortcuts: KeyboardShortcuts;
  private shortcutCommands: ShortcutCommand[];
  public scheduleController: ScheduleController;
  public serviceDaysController: ServiceDaysController;
  public themeController: ThemeController;
  public pageStateManager: PageStateManager;
  public historyController: HistoryController;
  public navbarCounts: NavbarCounts;
  public tabLock: TabLockController;
  public levelsController: LevelsController;
  public shapesManager: ShapesManager;
  // The home panel sits hidden behind the timetable modal, so its refresh
  // waits until the modal closes.
  private timetableOpen = false;
  private browseRefreshDeferred = false;

  constructor() {
    bindExtensionColumns(this.feed);
    bindFeedActiveRange(this.feed);
    this.mapController = new MapController();
    this.editor = new Editor();
    this.uiController = new UIController();
    this.scheduleController = new ScheduleController(this.feed);
    this.serviceDaysController = new ServiceDaysController(this.feed);
    this.browseNavigation = new BrowseNavigation(
      this.feed,
      this.mapController,
      this.serviceDaysController
    );
    this.searchController = new SearchController<SearchPayload>({
      getGroups: () => buildSearchGroups(this.feed),
      getRemoteEntries: (query, signal) =>
        searchPlaces(query, this.mapController.getCenter(), signal),
      onSelect: (payload) => {
        if (payload.kind === 'entity') {
          this.focusSearchResult(payload.state);
        } else {
          this.mapController.focusPlace(payload);
        }
      },
    });
    this.validator = new GTFSValidator(this.feed);
    this.shortcutCommands = editorShortcuts(this);
    this.keyboardShortcuts = new KeyboardShortcuts(this.shortcutCommands, () =>
      this.tabLock.isActive()
    );
    this.themeController = new ThemeController();

    this.pageStateManager = initializePageStateWithGTFS(this.feed);
    createModalRouter<ModalState>(this.pageStateManager);

    // A route_color shared by every route renders as no color. Registered
    // before the map's edit listener so its re-render reads the new state.
    this.feed.onEdit((e) => {
      if (e.kind !== 'change') {
        this.refreshRouteColors();
      } else if (e.tables.includes('routes') && this.refreshRouteColors()) {
        // The surgical map update only redraws the edited route.
        this.mapController
          .updateMap()
          .catch((err: unknown) =>
            console.error('[GTFSEditor] route color redraw failed:', err)
          );
      }
    });
    // Lets the home panel re-run validation itself when the feed has moved on
    // since the issues it is about to draw were published.
    setFeedIssueRevalidator({
      validate: () => this.validator.validateFeed(),
      source: this.feed,
      getStalenessKey: () => `${this.feed.feedGeneration}:${this.feed.version}`,
    });

    this.historyController = new HistoryController();
    this.navbarCounts = new NavbarCounts(this.feed);
    this.tabLock = new TabLockController();
    this.levelsController = new LevelsController(this.feed);
    this.shapesManager = new ShapesManager(this.feed);

    const appContainer = document.querySelector<HTMLElement>('.app-container')!;
    restorePanelWidth(appContainer);
    new PanelResizer(appContainer, this.mapController);
    initFieldTooltipPortal();

    // Timetable stop column -> map: hover the row to light up whatever it
    // references. A null ref clears all three kinds: the row is already gone,
    // so its kind is no longer readable.
    this.scheduleController.setStopHighlightHandlers({
      onRefHover: (ref) => {
        if (ref === null) {
          this.mapController.hoverStop(null);
          this.mapController.hoverZone(null);
          this.mapController.hoverLocationGroup(null);
          return;
        }
        if (ref.kind === 'stop') {
          this.mapController.hoverStop(ref.id);
        } else if (ref.kind === 'location') {
          this.mapController.hoverZone(ref.id);
        } else {
          this.mapController.hoverLocationGroup(ref.id);
        }
      },
    });

    // A timetable picker's footer button -> the modal that authors what the
    // picker lists. Both go through the hash, so the modal is linkable and
    // back closes it.
    this.scheduleController.setManagerHandlers({
      openOnDemand: (target) => {
        void openModal(
          { type: 'on_demand', ...(target.table && { table: target.table }) },
          { rowKey: target.rowKey }
        );
      },
      openShapes: () => {
        void openModal({ type: 'shapes' });
      },
      uploadShape: (tripId, currentShapeId) =>
        this.shapesManager.uploadShapeForTrip(tripId, currentShapeId),
    });

    this.init().catch((error) => {
      console.error('Failed to initialize GTFSEditor:', error);
      notify.error(t('app.initFailed'));
    });
  }

  private async init(): Promise<void> {
    try {
      if (CONFIG.DEBUG_BOOT) {
        console.time('[boot] total');
      }
      // Build the navbar before anything looks up a button by id.
      const navbarActions = document.getElementById('navbar-actions');
      if (navbarActions) {
        renderNavbarActions(navbarActions, NAVBAR_ACTIONS);
      }
      renderDockIcons(DOCK_ICONS);
      document.getElementById('auto-zoom-mount')!.innerHTML =
        renderAutoZoomControl();

      feedProgressIndicator.startLoading('boot', t('boot.openingDb'));

      // Claim tab lock before any module initialization
      this.tabLock.init();

      // Display version in header
      this.displayVersion();

      // Initialize notification system
      notify.initialize();

      // The previous storage layer's database holds nothing worth keeping.
      deleteLegacyDatabase();
      // A reset from the error modal releases the feed first: its worker
      // holds the files and the connection the reset deletes.
      databaseFallbackManager.setConnectionCloser(() => this.feed.release());

      const exportBtn = document.getElementById(
        'export-btn'
      ) as HTMLButtonElement;
      if (exportBtn) {
        exportBtn.disabled = false;
      }

      feedProgressIndicator.updateProgress('boot', 80, t('boot.buildingMap'));
      this.historyController.initialize(this.feed);
      this.navbarCounts.initialize();

      // Initialize all modules
      await this.mapController.initialize(this.feed, this.routeRefs);
      this.mapController.setPageStateManager(this.pageStateManager);
      this.mapController.setCallbacks({
        onEmptyClick: () => {
          this.pageStateManager.setPageState({ type: 'home' });
        },
      });
      this.editor.initialize(this.feed);

      this.uiController.initialize(
        this.feed,
        this.editor,
        this.mapController,
        this.browseNavigation
      );

      // Initialize Browse navigation
      this.browseNavigation.initialize('panel-content');

      // Set up circular references
      this.browseNavigation.uiController = this.uiController;

      // Initialize search controller
      this.searchController.initialize();

      // A rename re-points the page once the mirror holds the new rows and
      // before the edit listeners run, so every listener below re-renders
      // against the new ID rather than the deleted one.
      this.feed.setRenameFollower(({ keyField, from, to }) => {
        this.pageStateManager.followRename(keyField, from, to);
        this.browseNavigation.followRename(keyField, from, to);
        this.scheduleController.followIdRename(keyField, from, to);
      });

      // Edits and history moves: refresh the Files grid and the browse panel,
      // and say what happened. The map follows edits on its own.
      const refreshAfterMove = async () => {
        if (this.editor.getCurrentFile()) {
          await this.editor.buildTableEditor();
        }
        await this.refreshBrowse();
      };
      this.feed.onEdit((e) => {
        console.log(`[edit:${e.kind}]`, e.versions, e.tables, e.files);
        if (e.kind === 'change') {
          notify.info(humanLabel(e.patch), { duration: 3000 });
          this.refreshBrowse().catch((err: unknown) =>
            notify.error(
              t('edit.refreshAfterEditFailed', {
                message: err instanceof Error ? err.message : String(err),
              })
            )
          );
        } else {
          if (e.kind === 'undo') {
            notify.info(t('edit.undone', { label: humanLabel(e.patch) }), {
              duration: 3000,
            });
          } else if (e.kind === 'redo') {
            notify.info(t('edit.redone', { label: humanLabel(e.patch) }), {
              duration: 3000,
            });
          }
          refreshAfterMove().catch((err: unknown) =>
            notify.error(
              t('edit.refreshAfterUndoFailed', {
                message: err instanceof Error ? err.message : String(err),
              })
            )
          );
        }
        this.updateUndoRedoState();
      });

      // Every feed-scoped reset, in one place. Fires once the new feed is
      // fully adopted.
      this.feed.onFeedReplaced(() => {
        this.refreshRouteColors();
        // The new feed renders the home panel itself.
        this.browseRefreshDeferred = false;
        // Timetable data and picker options are keyed by ids that collide
        // across feeds, so stale entries redisplay the previous feed's rows.
        this.scheduleController.resetForNewFeed();
        // The previous feed's routes, stops and zones come off the map now
        // rather than at the start of the next render.
        this.mapController.clearForNewFeed();
        this.updateUndoRedoState();
        // Issues and the navbar count badges, off the critical path.
        runWhenIdle(() => {
          this.validateAndUpdateInfo().catch((e: unknown) =>
            console.error('[GTFSEditor] validation failed:', e)
          );
        });
      });

      // Initialize keyboard shortcuts
      this.keyboardShortcuts.initialize();

      // Content modals live in the URL hash: the navbar buttons move page
      // state, and the router below opens the modal that state names. The guide
      // page gating sits in the opener, not the button, so a deep link gets the
      // same first-use guide.
      this.registerModals(this.shapesManager);

      document
        .getElementById('timetable-btn')
        ?.addEventListener('click', () => {
          void openModal({ type: 'timetables' });
        });
      document
        .getElementById('dock-timetable')
        ?.addEventListener('click', () => {
          void openModal({ type: 'timetables' });
        });
      document.getElementById('shapes-btn')?.addEventListener('click', () => {
        void openModal({ type: 'shapes' });
      });
      document.getElementById('fares-btn')?.addEventListener('click', () => {
        void openModal({ type: 'fares' });
      });
      document
        .getElementById('transfers-btn')
        ?.addEventListener('click', () => {
          void openModal({ type: 'transfers' });
        });
      document
        .getElementById('translations-btn')
        ?.addEventListener('click', () => {
          void openModal({ type: 'translations' });
        });
      document
        .getElementById('attributions-btn')
        ?.addEventListener('click', () => {
          void openModal({ type: 'attributions' });
        });
      document
        .getElementById('on-demand-btn')
        ?.addEventListener('click', () => {
          void openModal({ type: 'on_demand' });
        });
      document.getElementById('calendar-btn')?.addEventListener('click', () => {
        void openModal({ type: 'calendar' });
      });
      document.getElementById('levels-btn')?.addEventListener('click', () => {
        void openModal({ type: 'levels' });
      });

      // Wire up guide modal
      setHelpPages(HELP_PAGES, HELP_GROUP_ORDER);
      setHelpRuntimeData({
        version: __APP_VERSION__,
        shortcuts: describeShortcuts(this.shortcutCommands),
      });
      document
        .getElementById('help-btn')
        ?.addEventListener('click', () => void showHelpModal());

      // Initialize theme controller
      this.themeController.initialize();
      this.themeController.onThemeChange(() =>
        this.mapController.refreshAccentColor()
      );

      // The Changes panel renders into the modal body, so it is filled on mount
      // and torn down with the modal.
      const openHistoryModal = () => {
        void showModal({
          title: t('nav.history'),
          body: '<div id="changes-panel"></div>',
          actions: [{ label: t('common.close'), onClick: () => {} }],
          escapeAction: 0,
          boxClassName: 'max-w-2xl w-11/12 h-[80vh]',
          onMount: () => {
            this.historyController
              .render()
              .catch((e: unknown) =>
                console.error('[history] render failed:', e)
              );
          },
        });
      };

      document
        .getElementById('history-btn')
        ?.addEventListener('click', openHistoryModal);

      // Initialize bottom sheet controller (mobile only)
      const rightPanel = document.getElementById('right-panel');
      const bottomSheet = rightPanel
        ? new BottomSheetController(rightPanel, [
            { id: 'dock-browse' },
            {
              id: 'dock-files',
              onSelect: () => void openModal({ type: 'files' }),
            },
            { id: 'dock-changes', snap: null, onSelect: openHistoryModal },
          ])
        : null;

      if (bottomSheet) {
        bottomSheet.onDismiss(
          () => void this.pageStateManager.setPageState({ type: 'home' })
        );
      }

      if (window.innerWidth < 768) {
        this.mapController.setBottomPadding(
          Math.round(window.innerHeight * 0.45)
        );
      }

      // Set up navigation event listener for automatic tab switching
      this.setupNavigationTabSwitching(bottomSheet);

      // Decide which feed this session is about, and hydrate it.
      const outcome = await this.bootFeed();

      // Initialize PageStateManager from URL. After the feed, so a deep-linked
      // object is validated against the rows that are actually loaded.
      await this.pageStateManager.initializeFromURL();

      // Only when the database holds no feed at all: creating one commits a new
      // generation and clears the patch log, so a failed restore or a failed
      // load must never land here. The user keeps whatever is stored and can
      // load again from the modal.
      if (outcome === 'nothing-stored') {
        console.log('[boot] nothing stored, creating an empty feed');
        await createEmptyFeed(this.feed, t('load.newEmpty'));
      }

      this.updateUndoRedoState();

      if (CONFIG.DEBUG_BOOT) {
        console.time('[boot] refresh after feed swap');
      }
      // The same post-swap refresh a user load runs, minus the navigation home:
      // boot's page state comes from the URL. The map update it schedules also
      // refreshes navigation once it lands, so a deep-linked stop keeps its
      // selection through the focus reset inside updateMap.
      await this.uiController.refreshAfterFeedSwap().catch((e: unknown) =>
        notify.error(
          t('boot.refreshFailed', {
            message: e instanceof Error ? e.message : String(e),
          })
        )
      );
      if (CONFIG.DEBUG_BOOT) {
        console.timeEnd('[boot] refresh after feed swap');
      }
      // initializeFromURL sets the state without dispatching a navigation, so
      // a modal named by the boot URL is opened here, once the feed it reads
      // is in place.
      getModalRouter().sync(this.pageStateManager.getPageState());
    } catch (error) {
      console.error('Failed to initialize application:', error);
      notify.error(t('app.initFailed'));
    } finally {
      feedProgressIndicator.finishLoading('boot');
      if (CONFIG.DEBUG_BOOT) {
        console.timeEnd('[boot] total');
      }
    }
  }

  /**
   * Which feed this session opens with.
   *
   * Boot does not restore the active feed unconditionally: parsing it is the
   * expensive half of startup, and it is the wrong feed as often as it is the
   * right one. The load modal comes first, led by "Your feeds". A deep link
   * into an object already states which feed is wanted, so it skips the
   * modal and opens the active feed. A `#load=` link always shows the modal,
   * with the link as its top card.
   */
  private async bootFeed(): Promise<BootOutcome> {
    const loadUrl = takeLoadCommand();

    if (loadUrl) {
      console.log('[boot] #load offered in the modal:', loadUrl);
    } else {
      const deepLink = this.pageStateManager.pendingStateFromURL();
      if (deepLink.type !== 'home' || deepLink.modal) {
        console.log(
          `[boot] skipped modal: deep link to ${deepLink.modal?.type ?? deepLink.type}`
        );
        return this.restoreStoredFeed();
      }
    }

    // The modal is the boot screen, not an interruption of a load in progress,
    // so the progress bar comes down while both it and the welcome page are up.
    feedProgressIndicator.finishLoading('boot');
    await showHelpPageOnce('welcome', {
      continueLabel: t('help.welcome.start'),
    });
    const choice = await this.uiController.openBootLoadModal(
      loadUrl ?? undefined
    );
    feedProgressIndicator.startLoading('boot', t('boot.openingFeed'));
    console.log(`[boot] load modal: user chose ${JSON.stringify(choice)}`);

    if (typeof choice === 'object') {
      return this.restoreStoredFeed(choice.stored);
    }
    if (choice === 'empty') {
      await createEmptyFeed(this.feed, t('load.newEmpty'));
      feedProgressIndicator.finishLoading('boot');
      await showHelpPageOnce('getting-started', {
        continueLabel: t('help.new.start'),
      });
      feedProgressIndicator.startLoading('boot', t('boot.openingFeed'));
      return 'created-empty';
    }
    // 'loaded' has already parsed the chosen feed into place.
    return 'loaded';
  }

  /**
   * Hand the feed's route colors to the shared route color rule. True when
   * that turned a shared color on or off, which recolors every route.
   */
  private refreshRouteColors(): boolean {
    if (!this.feed.isOpen) {
      return false;
    }
    const routes = this.feed.table('routes');
    const colors = () =>
      routes.map((r) => routeColor(r.route_id ?? '', r.route_color)).join();
    const before = colors();
    setFeedRouteColors(routes.map((route) => route.route_color));
    const changed = colors() !== before;
    if (changed) {
      console.log('[GTFSEditor] shared route color rule changed; recoloring');
    }
    return changed;
  }

  /**
   * Open stored feed `id` (the active one when omitted): its base, then the
   * patch log on top.
   */
  private async restoreStoredFeed(id?: string): Promise<BootOutcome> {
    if (CONFIG.DEBUG_BOOT) {
      console.time('[boot] restore stored feed');
    }
    try {
      if (!(await restoreFeed(this.feed, id))) {
        console.log('[boot] no stored feed to continue from');
        return 'nothing-stored';
      }
      console.log(
        `[boot] continue with stored feed (${this.feed.table('routes').length} routes)`
      );
      return 'restored';
    } catch (error) {
      // A cancelled restore is a clean state, not a failure: nothing was
      // installed, and the stored feed is untouched.
      if (error instanceof LoadCancelledError) {
        console.log('[boot] restore cancelled by the user');
        notify.info(t('common.loadCancelled'));
        return 'failed';
      }
      console.error('[boot] failed to restore the stored feed:', error);
      databaseFallbackManager.showDatabaseError(
        error,
        t('boot.restoreContext'),
        () => recoverStoredFeedExport(id)
      );
      return 'failed';
    } finally {
      if (CONFIG.DEBUG_BOOT) {
        console.timeEnd('[boot] restore stored feed');
      }
    }
  }

  // Runs on every whole-feed swap, via the parser's feed-replaced signal.
  // Publishes the grouped issues the home panel renders. Scheduled rather than
  // awaited by that signal, so a large feed is usable before it finishes.
  public async validateAndUpdateInfo(): Promise<void> {
    // Feed import writes rows directly, bypassing the patch events the count
    // badges otherwise listen to.
    this.navbarCounts.refresh();

    // Through the staleness check rather than straight at the validator: the
    // home panel usually renders the new feed first and has already validated
    // this generation, and a second full sweep would publish the same issues.
    await refreshFeedIssuesIfStale();
  }

  /**
   * Teach the modal router how to open each content modal, then let it react
   * to every navigation. Registration happens before the handler is added so a
   * navigation can never arrive at an empty registry.
   */
  private registerModals(shapesManager: ShapesManager): void {
    const router = getModalRouter<ModalState>();

    router.register('timetable', async (modal) => {
      this.timetableOpen = true;
      try {
        await showTimetableModal(
          {
            scheduleController: this.scheduleController,
            feed: this.feed,
          },
          modal
        );
      } finally {
        this.timetableOpen = false;
      }
      if (this.browseRefreshDeferred) {
        // Detached so the router clears the hash without waiting on it.
        console.log('[GTFSEditor] running deferred browse refresh');
        this.refreshBrowse().catch((e: unknown) =>
          notify.error(
            t('edit.refreshAfterEditFailed', {
              message: e instanceof Error ? e.message : String(e),
            })
          )
        );
      }
    });

    router.register('timetables', () => {
      const state = this.pageStateManager.getPageState();
      return showTimetableBrowserModal(
        {
          feed: this.feed,
          scheduleController: this.scheduleController,
        },
        state.type === 'route' ? state.route_id : null
      );
    });

    router.register('shapes', async (_modal, _transient, cancelled) => {
      if (
        (await showHelpPageOnce('shapes', {
          continueLabel: t('help.continueShapes'),
        })) &&
        cancelled()
      ) {
        return;
      }
      await shapesManager.open();
    });

    router.register('fares', async (_modal, _transient, cancelled) => {
      if (
        (await showHelpPageOnce('fares', {
          continueLabel: t('help.continueFares'),
        })) &&
        cancelled()
      ) {
        return;
      }
      await showFaresModal({ feed: this.feed });
    });

    router.register('transfers', (_modal, transient) =>
      showTransfersModal(
        { feed: this.feed },
        { focusStopId: transient.focusStopId, rowKey: transient.rowKey }
      )
    );

    router.register('translations', (modal, transient) =>
      showTranslationsModal(
        { feed: this.feed },
        { table: modal.table, rowKey: transient.rowKey }
      )
    );

    router.register('attributions', (_modal, transient) =>
      showAttributionsModal({ feed: this.feed }, transient.rowKey)
    );

    router.register('on_demand', async (modal, transient, cancelled) => {
      if (
        (await showHelpPageOnce('on-demand', {
          continueLabel: t('help.continueOnDemand'),
        })) &&
        cancelled()
      ) {
        return;
      }
      await showOnDemandModal(this.onDemandModalDeps(), {
        table: modal.table,
        rowKey: transient.rowKey,
      });
    });

    router.register('calendar', () =>
      showCalendarModal({
        feed: this.feed,
        onServiceClick: (service_id) => {
          // Navigating drops the modal from the state, so the router closes it.
          void this.pageStateManager.setPageState({
            type: 'service',
            service_id,
          });
        },
      })
    );

    router.register('levels', () => this.levelsController.showLevelsModal());

    router.register('files', (modal) =>
      this.uiController.openFilesModal(modal.table)
    );

    router.register('feed_issues', async (modal, _transient, cancelled) => {
      await refreshFeedIssuesIfStale();
      if (cancelled()) {
        return;
      }
      await showFeedIssuesModal({ feed: this.feed }, modal.table);
    });

    this.pageStateManager.addNavigationHandler((event) => {
      router.sync(event.to);
    });
  }

  /** Deps for the On-Demand modal, which several affordances can open. */
  private onDemandModalDeps(): Parameters<typeof showOnDemandModal>[0] {
    return {
      feed: this.feed,
      onZoneClick: (location_id) => {
        void this.pageStateManager.setPageState({ type: 'zone', location_id });
      },
      onCreateZone: async ({ location_id, stop_name, geometry }) => {
        const feature: ZoneFeature = {
          type: 'Feature',
          id: location_id,
          properties: stop_name ? { stop_name } : {},
          geometry,
        };
        await writeZoneFeatures(this.feed, [
          ...getZoneFeatures(this.feed),
          feature,
        ]);
        console.log(`[GTFSEditor] created zone ${location_id}`);
      },
    };
  }

  /**
   * A search result behaves exactly like clicking the object on the map or in
   * the sidebar: highlight it (which flies the map and sets the focused
   * object), then move page state so the sidebar and the URL follow.
   */
  private focusSearchResult(state: PageState): void {
    if (state.type === 'stop') {
      this.mapController.highlightStop(state.stop_id);
    } else if (state.type === 'route') {
      this.mapController.highlightRoute(state.route_id);
    }
    void this.pageStateManager.setPageState(state);
  }

  /**
   * Set up navigation event listener to automatically switch tabs based on PageState changes
   */
  private setupNavigationTabSwitching(
    bottomSheet: BottomSheetController | null
  ): void {
    this.pageStateManager.addNavigationHandler((event) => {
      const { to } = event;

      // Open the bottom sheet on mobile for route and stop navigation
      if (to.type === 'route' || to.type === 'stop') {
        bottomSheet?.open('half');
      }
    });
  }

  /**
   * Display version in header
   */
  // Refresh the home panel, or mark it dirty while the timetable covers it.
  private async refreshBrowse(): Promise<void> {
    if (this.timetableOpen) {
      if (!this.browseRefreshDeferred) {
        console.log('[GTFSEditor] browse refresh deferred: timetable open');
      }
      this.browseRefreshDeferred = true;
      return;
    }
    this.browseRefreshDeferred = false;
    await this.browseNavigation.refresh();
  }

  private displayVersion(): void {
    const versionElement = document.getElementById('app-version');
    if (versionElement) {
      versionElement.textContent = `v${__APP_VERSION__}`;
    }
  }

  private updateUndoRedoState(): void {
    const undoBtn = document.getElementById(
      'undo-btn'
    ) as HTMLButtonElement | null;
    const redoBtn = document.getElementById(
      'redo-btn'
    ) as HTMLButtonElement | null;
    const undoTooltip = document.getElementById('undo-tooltip');
    const redoTooltip = document.getElementById('redo-tooltip');

    const canUndo = this.feed.isOpen && this.feed.canUndo;
    const canRedo = this.feed.isOpen && this.feed.canRedo;

    if (undoBtn) {
      undoBtn.disabled = !canUndo;
    }
    if (redoBtn) {
      redoBtn.disabled = !canRedo;
    }

    if (!canUndo && !canRedo) {
      if (undoTooltip) {
        undoTooltip.dataset.tip = t('nav.nothingToUndo');
      }
      if (redoTooltip) {
        redoTooltip.dataset.tip = t('nav.nothingToRedo');
      }
      return;
    }

    this.feed
      .history()
      .then((history) => {
        const currentVersion = this.feed.version;

        if (undoTooltip) {
          if (canUndo) {
            const undoPatch = history.find((r) => r.version === currentVersion);
            undoTooltip.dataset.tip = undoPatch
              ? t('nav.undoLabel', { label: humanLabel(undoPatch.patch) })
              : t('nav.nothingToUndo');
          } else {
            undoTooltip.dataset.tip = t('nav.nothingToUndo');
          }
        }

        if (redoTooltip) {
          if (canRedo) {
            const redoPatch = history.find(
              (r) => r.version === currentVersion + 1
            );
            redoTooltip.dataset.tip = redoPatch
              ? t('nav.redoLabel', { label: humanLabel(redoPatch.patch) })
              : t('nav.nothingToRedo');
          } else {
            redoTooltip.dataset.tip = t('nav.nothingToRedo');
          }
        }
      })
      .catch((e: unknown) =>
        console.error('[undo/redo] Failed to get history for tooltip:', e)
      );
  }

  public undoEdit(): void {
    if (!this.feed.isOpen || !this.feed.canUndo) {
      notify.info(t('nav.nothingToUndo'));
      return;
    }
    this.feed.undo().catch((e: unknown) =>
      notify.error(
        t('edit.undoFailed', {
          message: e instanceof Error ? e.message : String(e),
        })
      )
    );
  }

  public redoEdit(): void {
    if (!this.feed.isOpen || !this.feed.canRedo) {
      notify.info(t('nav.nothingToRedo'));
      return;
    }
    this.feed.redo().catch((e: unknown) =>
      notify.error(
        t('edit.redoFailed', {
          message: e instanceof Error ? e.message : String(e),
        })
      )
    );
  }
}

/** Drop the previous storage layer's IndexedDB database. Not awaited. */
function deleteLegacyDatabase(): void {
  void deleteDatabaseWithTimeout(CONFIG.LEGACY_DB_NAME).then((outcome) =>
    console.log(
      `[GTFSEditor] legacy database ${CONFIG.LEGACY_DB_NAME}: ${outcome}`
    )
  );
}

// Initialize the application
function initializeApp(): void {
  window.gtfsEditor = new GTFSEditor();
  if (import.meta.env.DEV) {
    const feed = window.gtfsEditor.feed;
    window.__feed = {
      feed,
      load: (input: { url: string } | { file: File }, label: string) =>
        loadFeed(feed, input, label),
      restore: () => restoreFeed(feed),
      empty: (label: string) => createEmptyFeed(feed, label),
      reset: () => {
        feed.release();
        return resetFeedStorage();
      },
      build: { insertOp, updateOp, deleteOp, batch },
    };
  }
}

if (document.readyState === 'loading') {
  // DOM is still loading, wait for DOMContentLoaded
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  // DOM is already loaded, initialize immediately
  initializeApp();
}
