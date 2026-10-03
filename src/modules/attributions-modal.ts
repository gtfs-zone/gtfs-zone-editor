/**
 * `attributions.txt`: who the dataset, or one agency, route or trip in it, is
 * credited to. One spec-driven editable table in a plain modal.
 */

import { showModal } from 'gtfs-zone-web-common/ui/modal-utils';
import { escapeHtml } from 'gtfs-zone-web-common/util/escape-html';
import {
  renderEditableTable,
  installEditableTableHandlers,
  uninstallEditableTableHandlers,
  type EditableTableConfig,
  type EditableTableDeps,
} from './editable-table';
import { emptyState } from './fares-modal';
import { specStoreName } from '../utils/spec-field-edit';
import { GTFS_TABLES } from '../types/gtfs';

export type AttributionsModalDeps = EditableTableDeps;

const INSTANCE_ID = 'attributions-table';

const NOTE = `Leave agency_id, route_id and trip_id empty to attribute the whole
  dataset; setting one scopes the attribution to it. At least one of
  is_producer, is_operator and is_authority should be 1.`;

/**
 * An attribution names at most one of an agency, a route or a trip; naming none
 * attributes the whole dataset.
 *
 * The reference also says at least one of the role flags should be `1`, but
 * that is a recommendation and enforcing it here would refuse every edit to an
 * imported row that carries no role. It is stated in the note instead, and the
 * validator is where a feed-wide report of it belongs.
 */
export function validateAttributionRow(
  row: Record<string, unknown>
): string | null {
  const scopes = ['agency_id', 'route_id', 'trip_id'].filter(
    (field) => String(row[field] ?? '').trim() !== ''
  );
  if (scopes.length > 1) {
    return `Only one of agency_id, route_id or trip_id may be set (found ${scopes.join(', ')})`;
  }
  return null;
}

export async function showAttributionsModal(
  deps: AttributionsModalDeps,
  rowKey?: string
): Promise<void> {
  // Consumed by the first render only: a later refresh must not re-scroll.
  let pendingRowKey = rowKey;

  const config: EditableTableConfig = {
    instanceId: INSTANCE_ID,
    tableName: GTFS_TABLES.ATTRIBUTIONS,
    rows: [],
    deps,
    emptyMessage: emptyState(
      GTFS_TABLES.ATTRIBUTIONS,
      'Add one to credit an organization for the dataset, or for one agency, route or trip in it.'
    ),
    columnOverrides: {
      organization_name: { widthClass: 'min-w-48' },
    },
    validateRow: validateAttributionRow,
    onInsert: () => void refresh(),
    onRowsChanged: () => void refresh(),
    onDelete: () => void refresh(),
  };

  const refresh = async (): Promise<void> => {
    const panel = document.getElementById('attributions-panel');
    if (!panel) {
      return;
    }
    config.rows = await deps.gtfsDatabase.getAllRows(
      specStoreName(GTFS_TABLES.ATTRIBUTIONS)
    );
    panel.innerHTML = await renderEditableTable(config);

    if (!pendingRowKey) {
      return;
    }
    const target = pendingRowKey;
    pendingRowKey = undefined;
    const row = panel.querySelector(`[data-et-row="${CSS.escape(target)}"]`);
    if (row instanceof HTMLElement) {
      row.scrollIntoView({ block: 'center' });
      row.classList.add('bg-primary/10');
    } else {
      console.warn(`[Attributions] no row for ${target}`);
    }
  };

  installEditableTableHandlers(config);

  await showModal({
    title: 'Attributions',
    body: `
      <p class="text-sm opacity-70 mb-3">${escapeHtml(NOTE)}
        <a href="https://gtfs.org/documentation/schedule/reference/#attributionstxt"
           target="_blank" rel="noopener noreferrer" class="link">GTFS reference</a>.</p>
      <div id="attributions-panel"></div>`,
    boxClassName: 'max-w-6xl',
    escapeAction: 0,
    actions: [{ label: 'Close', onClick: () => {} }],
    onMount: () => void refresh(),
  });

  uninstallEditableTableHandlers(INSTANCE_ID);
}
