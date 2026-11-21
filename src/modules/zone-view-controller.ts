/**
 * Browse page for one on-demand zone (a locations.geojson feature).
 *
 * A zone has no CSV row, so `renderInlineEntityFields` cannot be used here: its
 * name and description live in the feature's properties and commit through
 * `setZoneProperties`, and its geometry goes through the geojson.io round trip
 * in `zone-geometry-editor`. The fields still edit by click-to-edit, like every
 * other entity page.
 */

import type { EditorFeed } from '../feed/editor-feed';
import { GTFS_TABLES } from '../types/gtfs';
import { escapeHtml } from 'gtfs-zone-web-common/util/escape-html';
import { getRouteDisplay, renderCardLabel } from '../utils/entity-display';
import { renderFieldLabel, type FieldConfig } from '../utils/field-component';
import { openInlineEditor } from '../utils/inline-edit';
import { renderTrashIcon } from 'gtfs-zone-web-common/ui/modal-utils';
import { notify } from 'gtfs-zone-web-common/ui/notification-system';
import {
  attachZoneGeometryHandlers,
  renderZoneGeometrySection,
} from './zone-geometry-editor';
import {
  getZoneFeature,
  setZoneProperties,
  zoneDescription,
  zoneName,
  type ZoneFeature,
} from './zone-store';
import { t } from '../i18n/messages';

/**
 * Own row class rather than the shared ROUTE_REF_ROW: the agency view
 * controller binds that class on every container it is handed, so reusing it
 * here would navigate twice per click.
 */
const ZONE_ROUTE_ROW = 'zone-route-row';

const DETAILS_FORM = 'zone-details-form';
const DETAILS_FIELD = 'zone-details-field';
const DELETE_BTN = 'zone-delete-btn';

/**
 * The editable feature properties. `tableName` is stops.txt because the flex
 * reference gives these two the same meaning as the stop fields of the same
 * name, which is where the label's tooltip and spec link come from.
 */
const ZONE_PROPERTY_FIELDS: FieldConfig[] = [
  {
    field: 'stop_name',
    label: t('view.name'),
    type: 'text',
    tableName: GTFS_TABLES.STOPS,
  },
  {
    field: 'stop_desc',
    label: t('view.description'),
    type: 'text',
    tableName: GTFS_TABLES.STOPS,
  },
];

function zoneFieldDisplay(value: string, placeholder: string): string {
  return value
    ? escapeHtml(value)
    : `<span class="opacity-40">${escapeHtml(placeholder)}</span>`;
}

/** One click-to-edit property row. Pair with `attachDetailsHandlers`. */
function renderZoneField(config: FieldConfig, value: string): string {
  const placeholder = config.placeholder ?? '-';
  const boxClass = `${DETAILS_FIELD} w-full cursor-pointer rounded-field border border-base-300 px-3 py-1.5 text-sm hover:bg-base-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary`;
  return `
    <fieldset class="fieldset isolate">
      ${renderFieldLabel(config)}
      <span class="${boxClass} block truncate" tabindex="0" role="button"
        data-field="${escapeHtml(config.field)}"
        data-value="${escapeHtml(value)}"
        data-placeholder="${escapeHtml(placeholder)}">${zoneFieldDisplay(value, placeholder)}</span>
    </fieldset>
  `;
}

export interface ZoneViewDependencies {
  feed: EditorFeed;
  onRouteClick?: (route_id: string) => void;
  /** Re-render the page after the geometry is rewritten. */
  onGeometryChanged?: (location_id: string) => void;
  /** Re-render the page after the name or description is rewritten. */
  onPropertiesChanged?: (location_id: string) => void;
  /** Remove the zone, cascading to the stop_times that reference it. */
  onDeleteZone?: (location_id: string) => Promise<void>;
}

export class ZoneViewController {
  private dependencies: ZoneViewDependencies;

  constructor(dependencies: ZoneViewDependencies) {
    this.dependencies = dependencies;
  }

  async renderZoneView(location_id: string): Promise<string> {
    console.log('[ZoneViewController] Rendering zone view for:', location_id);

    const feed = this.dependencies.feed;
    if (!feed.isOpen) {
      return this.renderError(t('view.zoneUnavailable'));
    }

    try {
      const feature = getZoneFeature(feed, location_id);
      if (!feature) {
        return this.renderError(
          t('view.zoneMissing', { id: escapeHtml(location_id) })
        );
      }

      const name = zoneName(feature) || location_id;
      const geometryHtml = await renderZoneGeometrySection(feed, location_id);
      const routesHtml = await this.renderRoutes(location_id);

      return `
        <div class="p-4 space-y-4">
          <div class="flex items-start justify-between gap-2">
            <div>
              <h2 class="text-lg font-semibold">${escapeHtml(name)}</h2>
              <div class="text-xs opacity-60 font-mono">${escapeHtml(location_id)}</div>
              <div class="badge badge-sm badge-outline mt-1">${t('view.onDemandZone')}</div>
            </div>
            <button type="button" class="btn btn-sm btn-error btn-outline ${DELETE_BTN}"
              data-location-id="${escapeHtml(location_id)}" title="${t('view.deleteZone')}">
              ${renderTrashIcon()}
            </button>
          </div>
          <div class="card bg-base-100 shadow-lg">
            <div class="card-body p-4">
              ${this.renderDetails(location_id, feature)}
            </div>
          </div>
          <div class="card bg-base-100 shadow-lg">
            <div class="card-body p-4">
              ${geometryHtml}
            </div>
          </div>
          <div class="card bg-base-100 shadow-lg">
            <div class="card-body p-4 space-y-2">
              <h3 class="font-semibold">${t('view.zoneRoutes')}</h3>
              ${routesHtml}
            </div>
          </div>
        </div>
      `;
    } catch (error) {
      console.error('[ZoneViewController] Error rendering zone view:', error);
      return this.renderError(t('view.zoneFailed'));
    }
  }

  /**
   * Name and description, the only two properties the flex reference gives a
   * locations.geojson feature, as click-to-edit rows.
   *
   * The markup mirrors `renderInlineEditableField` so a zone reads like every
   * other entity page, but deliberately does not wear its class: that module's
   * document-level listeners commit through the spec tables, and a zone
   * property lives inside a GeoJSON feature with no row to write.
   */
  private renderDetails(location_id: string, feature: ZoneFeature): string {
    const values: Record<string, string> = {
      stop_name: zoneName(feature),
      stop_desc: zoneDescription(feature),
    };
    const fields = ZONE_PROPERTY_FIELDS.map((field) =>
      renderZoneField(field, values[field.field])
    ).join('');
    return `
      <div class="space-y-3 ${DETAILS_FORM}" data-location-id="${escapeHtml(location_id)}">
        <h3 class="font-semibold">${t('view.details')}</h3>
        ${fields}
      </div>
    `;
  }

  /** Trips referencing the zone, collapsed to one row per route. */
  private async renderRoutes(location_id: string): Promise<string> {
    const feed = this.dependencies.feed;
    const stopTimes = await feed.where('stop_times', [
      { col: 'location_id', eq: location_id },
    ]);
    const tripIds = [...new Set(stopTimes.map((st) => st.trip_id))];
    const trips =
      tripIds.length > 0
        ? await feed.where('trips', [{ col: 'trip_id', in: tripIds }])
        : [];
    if (trips.length === 0) {
      return `<p class="text-sm opacity-60">${t('view.zoneNoStopTimes')}</p>`;
    }

    const counts = new Map<string, number>();
    for (const trip of trips) {
      const route_id = String(trip.route_id ?? '');
      if (route_id === '') {
        continue;
      }
      counts.set(route_id, (counts.get(route_id) ?? 0) + 1);
    }

    const rows: string[] = [];
    for (const [route_id, count] of counts) {
      const route = feed.byKey('routes', route_id);
      const label = route
        ? renderCardLabel(getRouteDisplay(route))
        : `<span class="font-mono">${escapeHtml(route_id)}</span>`;
      rows.push(`
        <div class="flex items-center gap-3 p-3 rounded-lg hover:bg-base-200 cursor-pointer transition-colors ${ZONE_ROUTE_ROW}" data-route-id="${escapeHtml(route_id)}">
          <div class="flex-1 min-w-0">${label}</div>
          <div class="badge badge-outline badge-sm">${t('count.trips', { count })}</div>
        </div>
      `);
    }
    return rows.join('');
  }

  addEventListeners(container: HTMLElement): void {
    const feed = this.dependencies.feed;
    if (feed.isOpen) {
      attachZoneGeometryHandlers(container, {
        feed,
        onGeometryChanged: (location_id) =>
          this.dependencies.onGeometryChanged?.(location_id),
      });
      this.attachDetailsHandlers(container);
    }

    container
      .querySelector<HTMLButtonElement>(`.${DELETE_BTN}`)
      ?.addEventListener('click', (event) => {
        const location_id =
          (event.currentTarget as HTMLElement).dataset.locationId ?? '';
        if (location_id) {
          void this.dependencies.onDeleteZone?.(location_id);
        }
      });

    if (!this.dependencies.onRouteClick) {
      return;
    }
    container.querySelectorAll(`.${ZONE_ROUTE_ROW}`).forEach((row) => {
      row.addEventListener('click', () => {
        const route_id = row.getAttribute('data-route-id');
        if (route_id) {
          this.dependencies.onRouteClick!(route_id);
        }
      });
    });
  }

  /**
   * Open the editor on click, Enter or Space, and commit on blur, which is the
   * contract `utils/inline-edit` carries for every editable value in the app.
   */
  private attachDetailsHandlers(container: HTMLElement): void {
    const form = container.querySelector<HTMLElement>(`.${DETAILS_FORM}`);
    if (!form) {
      return;
    }
    const location_id = form.dataset.locationId ?? '';

    const open = (span: HTMLElement): void => {
      openInlineEditor(span, {
        value: span.dataset.value ?? '',
        inputType: 'text',
        sizeClass: 'input-sm',
        className: 'w-full',
        placeholder: span.dataset.placeholder,
        onCommit: (value) =>
          this.commitProperty(location_id, span, value.trim()),
      });
    };

    form.querySelectorAll<HTMLElement>(`.${DETAILS_FIELD}`).forEach((span) => {
      span.addEventListener('click', () => open(span));
      span.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open(span);
        }
      });
    });
  }

  /** Write one edited property, leaving the span as it was on failure. */
  private async commitProperty(
    location_id: string,
    span: HTMLElement,
    value: string
  ): Promise<void> {
    const field = span.dataset.field ?? '';
    if (!field || value === (span.dataset.value ?? '')) {
      return;
    }

    try {
      await setZoneProperties(this.dependencies.feed, location_id, {
        [field]: value,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notify.error(message);
      console.warn(`[ZoneViewController] ${location_id}.${field}: ${message}`);
      return;
    }

    span.dataset.value = value;
    span.innerHTML = zoneFieldDisplay(value, span.dataset.placeholder ?? '-');
    this.dependencies.onPropertiesChanged?.(location_id);
  }

  private renderError(message: string): string {
    return `
      <div class="alert alert-error m-4">
        <span>${message}</span>
      </div>
    `;
  }
}
