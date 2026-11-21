/**
 * Page State Integration
 *
 * Integration layer between PageStateManager and GTFS data.
 * Sets up breadcrumb lookup and provides convenience functions.
 */

import { PageStateManager, initPageStateManager } from './page-state-manager';
import { createGTFSBreadcrumbLookup } from './gtfs-breadcrumb-lookup';
import type { EditorFeed } from '../feed/editor-feed';
import { getZoneFeature } from './zone-store';

/**
 * Initialize the page state system with GTFS integration
 */
export function initializePageStateWithGTFS(
  feed: EditorFeed
): PageStateManager {
  // Initialize PageStateManager with hash-based URL sync enabled
  const pageStateManager = initPageStateManager({ enableUrlSync: true });

  pageStateManager.setBreadcrumbLookup(createGTFSBreadcrumbLookup(feed));

  // Inject state validator so restored hash states are checked against live data
  pageStateManager.setStateValidator(async (state) => {
    if (!feed.isOpen) {
      return state.type === 'home';
    }
    switch (state.type) {
      case 'route':
        return feed.byKey('routes', state.route_id) !== null;
      case 'stop':
        return feed.byKey('stops', state.stop_id) !== null;
      case 'agency':
        return feed.byKey('agency', state.agency_id) !== null;
      case 'service':
        return (
          feed.byKey('calendar', state.service_id) !== null ||
          (await feed.findOne(
            'calendar_dates',
            'service_id',
            state.service_id
          )) !== null
        );
      case 'zone':
        return getZoneFeature(feed, state.location_id) !== null;
      case 'location_group':
        return feed.byKey('location_groups', state.location_group_id) !== null;
      default:
        return true;
    }
  });

  return pageStateManager;
}

/**
 * Consume the `#load=<url>` command, returning the URL it named.
 *
 * Removing it from the hash is the consuming half: the command is an
 * instruction to boot, not page state, and it must not survive a reload.
 * Boot loads the URL directly; the link already states the intent.
 */
export function takeLoadCommand(): string | null {
  const rawHash = window.location.hash.slice(1);
  const params = new URLSearchParams(rawHash);
  const loadUrl = params.get('load');

  if (!loadUrl) {
    return null;
  }
  params.delete('load');
  // The PSM ignores a hashchange that names the state it already holds.
  window.location.hash = params.toString();
  console.log('[page-state-integration] takeLoadCommand:', loadUrl);
  return loadUrl;
}
