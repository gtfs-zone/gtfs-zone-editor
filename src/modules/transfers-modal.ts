/**
 * `transfers.txt`, grouped by the station of each row's from stop.
 *
 * A large feed has thousands of transfers, so rows are not rendered up front:
 * each group is a collapsed `<details>` whose editable table is only built
 * when it is expanded, from that group's rows read through the
 * `from_stop_id` index.
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
import type { GTFSParser } from './gtfs-parser';
import { getEntityDisplay } from '../utils/entity-display';
import { specStoreName } from '../utils/spec-field-edit';
import { validateTransferRow } from '../utils/fares-rules';
import { GTFS_FIELD_SPECS, GTFS_TABLES } from '../types/gtfs';

export interface TransfersModalDeps extends EditableTableDeps {
  gtfsParser: Pick<GTFSParser, 'getFileDataSync'>;
}

/** Which station's group to open on, and which row to draw attention to. */
export interface TransfersModalTarget {
  focusStopId?: string;
  rowKey?: string;
}

const STORE = specStoreName(GTFS_TABLES.TRANSFERS);
const NEW_INSTANCE_ID = 'transfers-new';
const SEARCH_DEBOUNCE_MS = 200;

/** Key of the group holding rows with no from stop (types 4 and 5). */
const TRIP_GROUP_KEY = '';

const NOTE = `Rows are grouped by the station of their from stop. Transfer
  types 4 and 5 link two trips of the same vehicle and name trips instead of
  stops. A transfer from a station applies to all of its child stops.`;

interface TransferGroup {
  /** The from stop's parent station, the stop itself, or TRIP_GROUP_KEY. */
  key: string;
  label: string;
  /** The distinct from_stop_ids whose rows make up the group. */
  fromStopIds: string[];
  count: number;
  countByType: Map<string, number>;
  /** Lowercased station and from stop names and ids, for the search box. */
  searchText: string;
}

interface StopInfo {
  name: string;
  parent: string;
}

function instanceIdFor(key: string): string {
  return key === TRIP_GROUP_KEY ? 'transfers-trips' : `transfers-group-${key}`;
}

/** The group a row with this from stop belongs to. */
function groupKeyFor(fromStopId: string, stops: Map<string, StopInfo>): string {
  if (fromStopId === '') {
    return TRIP_GROUP_KEY;
  }
  return stops.get(fromStopId)?.parent || fromStopId;
}

/** Stop names and parents, copied out of the live stops table. */
function readStops(
  parser: TransfersModalDeps['gtfsParser']
): Map<string, StopInfo> {
  const stops = new Map<string, StopInfo>();
  for (const row of parser.getFileDataSync(GTFS_TABLES.STOPS)) {
    stops.set(String(row.stop_id ?? ''), {
      name: String(row.stop_name ?? ''),
      parent: String(row.parent_station ?? ''),
    });
  }
  return stops;
}

/**
 * One read-only pass over the live transfers table. Only strings and counts
 * are kept, never the rows themselves.
 */
function buildGroups(
  parser: TransfersModalDeps['gtfsParser'],
  stops: Map<string, StopInfo>
): TransferGroup[] {
  const started = performance.now();
  const byKey = new Map<string, TransferGroup>();
  const fromIdsByKey = new Map<string, Set<string>>();

  for (const row of parser.getFileDataSync(GTFS_TABLES.TRANSFERS)) {
    const fromStopId = String(row.from_stop_id ?? '');
    const type = String(row.transfer_type ?? '') || '0';
    const key = groupKeyFor(fromStopId, stops);

    let group = byKey.get(key);
    if (!group) {
      const station = stops.get(key);
      group = {
        key,
        label:
          key === TRIP_GROUP_KEY
            ? 'Trip to trip'
            : getEntityDisplay('stops', {
                stop_id: key,
                stop_name: station?.name ?? '',
              }).primary,
        fromStopIds: [],
        count: 0,
        countByType: new Map(),
        searchText: '',
      };
      byKey.set(key, group);
      fromIdsByKey.set(key, new Set());
    }
    group.count++;
    group.countByType.set(type, (group.countByType.get(type) ?? 0) + 1);
    fromIdsByKey.get(key)!.add(fromStopId);
  }

  for (const group of byKey.values()) {
    group.fromStopIds = [...fromIdsByKey.get(group.key)!];
    const terms = [group.key, group.label];
    for (const id of group.fromStopIds) {
      terms.push(id, stops.get(id)?.name ?? '');
    }
    group.searchText = terms.join('\n').toLowerCase();
  }

  const groups = [...byKey.values()].sort((a, b) => {
    // Trip to trip rows have no station, so they go last.
    if (a.key === TRIP_GROUP_KEY || b.key === TRIP_GROUP_KEY) {
      return a.key === TRIP_GROUP_KEY ? 1 : -1;
    }
    return a.label.localeCompare(b.label);
  });
  console.log(
    `[Transfers] grouped ${groups.reduce((n, g) => n + g.count, 0)} rows into ${groups.length} groups in ${Math.round(performance.now() - started)} ms`
  );
  return groups;
}

/** "3 Timed transfer" style chips, one per transfer_type present. */
function renderTypeChips(group: TransferGroup): string {
  const enumValues =
    GTFS_FIELD_SPECS[GTFS_TABLES.TRANSFERS].transfer_type.enumValues ?? [];
  return [...group.countByType.entries()]
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([type, count]) => {
      const label =
        enumValues.find((value) => String(value.value) === type)?.label ??
        `Type ${type}`;
      return `<span class="badge badge-ghost badge-sm whitespace-nowrap" title="transfer_type ${escapeHtml(type)}">${count} ${escapeHtml(label)}</span>`;
    })
    .join('');
}

function renderGroupSummary(group: TransferGroup): string {
  const id =
    group.key !== TRIP_GROUP_KEY && group.label !== group.key
      ? `<span class="font-mono text-xs opacity-60">${escapeHtml(group.key)}</span>`
      : '';
  return `
    <summary class="cursor-pointer py-2 flex flex-wrap items-center gap-2">
      <span class="font-medium">${escapeHtml(group.label)}</span>
      ${id}
      <span class="text-xs opacity-60">${group.count} row${group.count === 1 ? '' : 's'}</span>
      <span class="flex flex-wrap gap-1">${renderTypeChips(group)}</span>
    </summary>`;
}

export async function showTransfersModal(
  deps: TransfersModalDeps,
  target: TransfersModalTarget = {}
): Promise<void> {
  let stops = readStops(deps.gtfsParser);
  let groups = buildGroups(deps.gtfsParser, stops);
  let search = '';
  const expanded = new Set<string>();
  // Group instances currently holding handlers, by group key.
  const installed = new Map<string, EditableTableConfig>();
  // Row to scroll to and highlight once its group has rendered.
  let pendingHighlight: { group: string; rowKey: string } | null = null;
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  if (target.focusStopId !== undefined) {
    const key = groupKeyFor(target.focusStopId, stops);
    if (groups.some((group) => group.key === key)) {
      expanded.add(key);
      if (target.rowKey) {
        pendingHighlight = { group: key, rowKey: target.rowKey };
      }
    } else {
      console.warn(`[Transfers] no transfers from ${target.focusStopId}`);
    }
  }

  const groupsEl = (): HTMLElement | null =>
    document.getElementById('transfers-groups');

  const groupEl = (key: string): HTMLDetailsElement | null => {
    const el = groupsEl()?.querySelector(
      `details[data-group="${CSS.escape(key)}"]`
    );
    return el instanceof HTMLDetailsElement ? el : null;
  };

  const uninstallGroup = (key: string): void => {
    if (installed.delete(key)) {
      uninstallEditableTableHandlers(instanceIdFor(key));
    }
  };

  /** Rebuild the groups after a write and redraw the list. */
  const onRowsWritten = (): void => {
    stops = readStops(deps.gtfsParser);
    groups = buildGroups(deps.gtfsParser, stops);
    void renderGroups();
  };

  const renderGroupBody = async (group: TransferGroup): Promise<void> => {
    const body = groupEl(group.key)?.querySelector('[data-group-body]');
    if (!(body instanceof HTMLElement)) {
      return;
    }
    body.dataset.rendered = '1';

    const rows: Record<string, unknown>[] = [];
    for (const fromStopId of group.fromStopIds) {
      rows.push(
        ...(await deps.gtfsDatabase.queryRows(STORE, {
          from_stop_id: fromStopId,
        }))
      );
    }
    const config: EditableTableConfig = {
      instanceId: instanceIdFor(group.key),
      tableName: GTFS_TABLES.TRANSFERS,
      rows,
      deps,
      hideNewRow: true,
      columnOverrides: {
        from_stop_id: { widthClass: 'min-w-48' },
        to_stop_id: { widthClass: 'min-w-48' },
      },
      validateRow: validateTransferRow,
      onInsert: onRowsWritten,
      onUpdate: onRowsWritten,
      onDelete: onRowsWritten,
      onRowsChanged: onRowsWritten,
    };
    const html = await renderEditableTable(config);
    // Collapsed, or redrawn, while the rows were being read.
    if (!body.isConnected || !expanded.has(group.key)) {
      return;
    }
    body.innerHTML = html;
    installed.set(group.key, config);
    installEditableTableHandlers(config);

    if (pendingHighlight?.group === group.key) {
      const rowKey = pendingHighlight.rowKey;
      pendingHighlight = null;
      const row = body.querySelector(`[data-et-row="${CSS.escape(rowKey)}"]`);
      if (row instanceof HTMLElement) {
        row.scrollIntoView({ block: 'center' });
        row.classList.add('bg-primary/10');
      } else {
        console.warn(`[Transfers] no row for ${rowKey}`);
      }
    }
  };

  const renderGroups = async (): Promise<void> => {
    const container = groupsEl();
    if (!container) {
      return;
    }
    // The modal body scrolls; a redraw after an edit must not move it.
    const scroller = container.closest('.overflow-y-auto');
    const scrollTop = scroller?.scrollTop ?? 0;
    for (const key of [...installed.keys()]) {
      uninstallGroup(key);
    }

    const needle = search.trim().toLowerCase();
    const shown = needle
      ? groups.filter((group) => group.searchText.includes(needle))
      : groups;
    const total = groups.reduce((n, group) => n + group.count, 0);

    const totalEl = document.getElementById('transfers-total');
    if (totalEl) {
      totalEl.textContent = needle
        ? `${shown.length} of ${groups.length} groups`
        : `${total} transfer${total === 1 ? '' : 's'} in ${groups.length} group${groups.length === 1 ? '' : 's'}`;
    }

    container.innerHTML =
      shown.length === 0
        ? `<p class="text-sm opacity-60 py-4">${needle ? 'No station matches the search.' : 'No transfers yet. Add one above to make a connection timed, to give it a minimum time, or to rule it out.'}</p>`
        : shown
            .map(
              (group) => `
          <details data-group="${escapeHtml(group.key)}" class="border-b border-base-content/10"${expanded.has(group.key) ? ' open' : ''}>
            ${renderGroupSummary(group)}
            <div data-group-body class="pb-3"></div>
          </details>`
            )
            .join('');

    const highlighting = pendingHighlight !== null;
    await Promise.all(
      shown
        .filter((group) => expanded.has(group.key))
        .map((group) => renderGroupBody(group))
    );
    if (!highlighting && scroller) {
      scroller.scrollTop = scrollTop;
    }
  };

  const newConfig: EditableTableConfig = {
    instanceId: NEW_INSTANCE_ID,
    tableName: GTFS_TABLES.TRANSFERS,
    rows: [],
    deps,
    columnOverrides: {
      from_stop_id: { widthClass: 'min-w-48' },
      to_stop_id: { widthClass: 'min-w-48' },
    },
    validateRow: validateTransferRow,
    onInsert: (key, record) => {
      stops = readStops(deps.gtfsParser);
      const group = groupKeyFor(String(record.from_stop_id ?? ''), stops);
      console.log(`[Transfers] inserted ${key} into group "${group}"`);
      expanded.add(group);
      pendingHighlight = { group, rowKey: key };
      void renderNew();
      onRowsWritten();
    },
  };

  const renderNew = async (): Promise<void> => {
    const el = document.getElementById('transfers-new');
    if (el) {
      el.innerHTML = await renderEditableTable(newConfig);
    }
  };

  const onMount = (): void => {
    void renderNew();
    void renderGroups();

    const container = groupsEl();
    // toggle does not bubble, so it is caught on the way down.
    container?.addEventListener(
      'toggle',
      (e) => {
        const details = e.target;
        if (!(details instanceof HTMLDetailsElement)) {
          return;
        }
        const key = details.dataset.group ?? '';
        const body = details.querySelector('[data-group-body]');
        if (!(body instanceof HTMLElement)) {
          return;
        }
        if (details.open) {
          expanded.add(key);
          const group = groups.find((g) => g.key === key);
          if (group && body.dataset.rendered !== '1') {
            void renderGroupBody(group);
          }
        } else {
          expanded.delete(key);
          uninstallGroup(key);
          body.innerHTML = '';
          delete body.dataset.rendered;
        }
      },
      true
    );

    document
      .getElementById('transfers-search')
      ?.addEventListener('input', (e) => {
        const value = (e.target as HTMLInputElement).value;
        if (searchTimer !== null) {
          clearTimeout(searchTimer);
        }
        searchTimer = setTimeout(() => {
          searchTimer = null;
          search = value;
          void renderGroups();
        }, SEARCH_DEBOUNCE_MS);
      });
  };

  installEditableTableHandlers(newConfig);

  await showModal({
    title: 'Transfers',
    body: `
      <p class="text-sm opacity-70 mb-3">${escapeHtml(NOTE)}
        <a href="https://gtfs.org/documentation/schedule/reference/#transferstxt"
           target="_blank" rel="noopener noreferrer" class="link">GTFS reference</a>.</p>
      <div class="mb-4">
        <h4 class="text-sm font-semibold mb-1">New transfer</h4>
        <div id="transfers-new"></div>
      </div>
      <div class="flex items-center gap-3 mb-2">
        <input id="transfers-search" type="search" class="input input-sm w-72"
               placeholder="Search stations and stops" autocomplete="off">
        <span id="transfers-total" class="text-sm opacity-60"></span>
      </div>
      <div id="transfers-groups"></div>`,
    boxClassName: 'max-w-6xl',
    escapeAction: 0,
    actions: [{ label: 'Close', onClick: () => {} }],
    onMount,
  });

  if (searchTimer !== null) {
    clearTimeout(searchTimer);
  }
  for (const key of [...installed.keys()]) {
    uninstallGroup(key);
  }
  uninstallEditableTableHandlers(NEW_INSTANCE_ID);
}
