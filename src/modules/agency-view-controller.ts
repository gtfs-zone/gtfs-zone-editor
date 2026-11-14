/**
 * Agency View Controller
 *
 * Comprehensive agency view implementation with inline editing and routes list.
 * Provides a single-column layout showing agency properties and related routes.
 */

import type { EditorFeed, FeedRow } from '../feed/editor-feed';
import { renderInlineEntityFields } from '../utils/inline-editable-field';
import { GTFS_TABLES } from '../types/gtfs';
import { normalizeAgencyId, agencyRouteFilter } from '../utils/agency-helpers';
import {
  renderRouteReference,
  ROUTE_REF_ROW,
} from '../utils/entity-references';
import { renderTrashIcon } from 'gtfs-zone-web-common/ui/modal-utils';
import { escapeHtml } from 'gtfs-zone-web-common/util/escape-html';
import { t } from '../i18n/messages';

export interface AgencyViewDependencies {
  feed: EditorFeed;
  onRouteClick: (route_id: string) => void;
  onDeleteAgency?: (agency_id: string) => void;
}

export class AgencyViewController {
  private dependencies: AgencyViewDependencies;
  private currentAgencyId: string | null = null;

  constructor(dependencies: AgencyViewDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Render comprehensive agency view
   */
  async renderAgencyView(agency_id: string): Promise<string> {
    this.currentAgencyId = agency_id;
    console.log('AgencyViewController: Rendering agency view for:', agency_id);

    try {
      // Get agency data
      const agency = this.dependencies.feed.byKey(
        'agency',
        normalizeAgencyId(agency_id)
      );
      if (!agency) {
        return this.renderError(t('view.agencyNotFound'));
      }

      // Get related routes
      const routes = this.getRoutesForAgency(agency_id);

      // Build trip count per route
      const tripsPerRoute = await this.dependencies.feed.countBy(
        'trips',
        'route_id'
      );
      const tripCountByRoute = new Map<string, number>(
        routes.map((r) => [r.route_id, tripsPerRoute[r.route_id] ?? 0])
      );

      // Render complete view
      const html = `
        <div class="p-4 space-y-4">
          ${await this.renderAgencyProperties(agency)}
          ${this.renderRoutesList(routes, agency_id, tripCountByRoute)}
        </div>
      `;
      console.log('Agency view HTML length:', html.length);
      return html;
    } catch (error) {
      console.error('Error rendering agency view:', error);
      return this.renderError(t('view.agencyFailed'));
    }
  }

  /**
   * Render editable agency properties section
   */
  private async renderAgencyProperties(agency: FeedRow): Promise<string> {
    const fieldsHtml = await renderInlineEntityFields(
      GTFS_TABLES.AGENCY,
      agency as Record<string, string | number | undefined>,
      this.currentAgencyId ?? ''
    );

    return `
      <div class="space-y-4">
        <div class="flex items-center justify-between gap-2">
          <h2 class="text-lg font-semibold">${t('view.agencyProperties')}</h2>
          <button class="btn btn-sm btn-error btn-outline delete-agency-btn" data-agency-id="${this.currentAgencyId ?? ''}" title="${t('common.delete')}">${renderTrashIcon()}</button>
        </div>
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
   * Render routes list section
   */
  private renderRoutesList(
    routes: FeedRow[],
    agency_id: string,
    tripCountByRoute: Map<string, number>
  ): string {
    const routeItems = routes
      .map((route) =>
        renderRouteReference(route as Record<string, unknown>, {
          tripCount: tripCountByRoute.get(route.route_id),
        })
      )
      .join('');

    return `
      <div class="space-y-4">
        <div class="flex items-center justify-between gap-4">
          <h2 class="text-lg font-semibold">${t('view.routes')}</h2>
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="btn btn-sm btn-primary"
              data-entity-create="route"
              data-agency-id="${escapeHtml(agency_id)}"
            >${t('view.newRoute')}</button>
          </div>
        </div>
        <div class="card bg-base-100 shadow-lg">
          <div class="card-body p-4">
            ${
              routes.length === 0
                ? `<div class="text-center py-6 opacity-70">
                    ${t('view.noRoutes')}
                  </div>`
                : `<div class="space-y-2">
                    ${routeItems}
                  </div>`
            }
          </div>
        </div>
      </div>
    `;
  }

  /** Routes of this agency, unassigned ones included for a single agency. */
  private getRoutesForAgency(agency_id: string): FeedRow[] {
    const feed = this.dependencies.feed;
    const accepted = new Set(
      agencyRouteFilter(agency_id, feed.table('agency').length)
    );
    return feed
      .table('routes')
      .filter((r) => accepted.has(normalizeAgencyId(r.agency_id)));
  }

  /**
   * Add event listeners for interactive elements
   */
  addEventListeners(container: HTMLElement): void {
    // Route reference row clicks
    const routeItems = container.querySelectorAll(`.${ROUTE_REF_ROW}`);
    routeItems.forEach((item) => {
      item.addEventListener('click', () => {
        const route_id = item.getAttribute('data-route-id');
        if (route_id) {
          this.dependencies.onRouteClick(route_id);
        }
      });
    });

    // Delete agency button
    const deleteBtn = container.querySelector('.delete-agency-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => {
        const agency_id = deleteBtn.getAttribute('data-agency-id');
        if (agency_id !== null && this.dependencies.onDeleteAgency) {
          this.dependencies.onDeleteAgency(agency_id);
        }
      });
    }
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
}
