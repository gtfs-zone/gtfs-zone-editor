import { CONFIG } from '../config';
import { notify } from 'gtfs-zone-web-common/ui/notification-system';
import { formatNumber } from 'gtfs-zone-web-common/i18n/fmt';
import type { EditorFeed } from '../feed/editor-feed';
import { updateOp } from '../feed/patch-build';
import { gtfsSpec } from '../gtfs-spec';
import { fileOrigin, renderSpecNotes } from '../utils/spec-origin';
import {
  installEditableTableHandlers,
  renderEditableTable,
  uninstallEditableTableHandlers,
  type EditableTableConfig,
  type EditableTableDeps,
} from './editable-table';
import { specStoreName } from '../utils/spec-field-edit';
import Clusterize from 'clusterize.js';
import {
  getGTFSFieldDescription,
  createTooltip,
} from '../utils/zod-tooltip-helper';
import { renderSpecDescriptionPlain } from 'gtfs-zone-web-common/gtfs/spec-markup';
import { getGTFSPrimaryKey } from '../utils/gtfs-primary-keys';
import { keyToGridDirection } from '../utils/grid-navigation';
import { t } from '../i18n/messages';

interface PendingUpdate {
  rowIndex: number;
  rowData: CSVRow;
  originalInput: HTMLInputElement | null;
}

type CSVRow = Record<string, string | number | boolean>;

/** editable-table instance id for an overlay file open in the Files view. */
const OVERLAY_TABLE_ID = 'files-overlay';

export class Editor {
  private currentFile: string | null = null;
  private tableData: CSVRow[] | null = null;
  private feed: EditorFeed | null = null;
  private clusterize: Clusterize | null = null;
  private headers: string[] = [];
  private pendingUpdates: Map<string, PendingUpdate> = new Map();
  private pendingBeforeRows: Map<number, CSVRow> = new Map();
  private debounceTimeout: NodeJS.Timeout | null = null;
  private readonly DEBOUNCE_DELAY = CONFIG.DEBOUNCE_DELAY;
  private overlayTable: EditableTableConfig | null = null;

  initialize(feed: EditorFeed): void {
    this.feed = feed;
  }

  async openFile(fileName: string): Promise<void> {
    if (!this.feed) {
      return;
    }

    // Non-table entries: a .txt opens as a read-only grid, anything else
    // (locations.geojson, non-CSV passthrough files) as text.
    if ((await this.feed.fileNames()).includes(fileName)) {
      if (fileName.toLowerCase().endsWith('.txt')) {
        await this.openFileGrid(fileName);
      } else {
        this.openRawFile(fileName, (await this.feed.fileText(fileName)) ?? '');
      }
      return;
    }

    // Clear table data when switching to a new file
    this.tableData = null;
    this.closeOverlayTable();

    // Update current file
    this.currentFile = fileName;
    const fileNameElement = document.getElementById('current-file-name');
    if (fileNameElement) {
      fileNameElement.textContent = fileName;
    }

    this.renderFileNotes(fileName);

    // Show table editor view
    const tableView = document.getElementById('table-editor-view');
    if (tableView) {
      tableView.classList.remove('hidden');
    }
    document.getElementById('raw-editor-view')?.classList.add('hidden');

    if (fileOrigin(fileName)) {
      await this.openOverlayTable(fileName);
      return;
    }
    await this.buildTableEditor();
  }

  /**
   * Overlay files open in the spec-driven editable table rather than the
   * cell grid, so rows can be added and deleted: a file added from the Files
   * list starts out empty.
   */
  private async openOverlayTable(fileName: string): Promise<void> {
    const feed = this.feed;
    if (!feed) {
      throw new Error('[Editor] feed not set');
    }
    if (this.clusterize) {
      this.clusterize.destroy();
      this.clusterize = null;
    }
    const deps: EditableTableDeps = { feed };
    const store = specStoreName(fileName);
    const refresh = async (): Promise<void> => {
      const container = document.getElementById('table-editor');
      if (!container || this.overlayTable !== config) {
        return;
      }
      config.rows = await feed.where(store, []);
      container.innerHTML = `<div class="p-2">${await renderEditableTable(config)}</div>`;
    };
    const config: EditableTableConfig = {
      instanceId: OVERLAY_TABLE_ID,
      scrollRows: true,
      tableName: fileName,
      rows: [],
      deps,
      onInsert: () => void refresh(),
      onDelete: () => void refresh(),
      onRowsChanged: () => void refresh(),
    };
    this.overlayTable = config;
    installEditableTableHandlers(config);
    await refresh();
    console.log(
      '[Editor] opened overlay file in the editable table:',
      fileName
    );
  }

  private closeOverlayTable(): void {
    if (this.overlayTable) {
      uninstallEditableTableHandlers(OVERLAY_TABLE_ID);
      this.overlayTable = null;
    }
  }

  /** Show the overlay notes on a file (Google's "Unsupported files"), if any. */
  private renderFileNotes(fileName: string): void {
    const el = document.getElementById('file-spec-notes');
    if (!el) {
      return;
    }
    const notes =
      gtfsSpec.files.find((f) => f.filename === fileName)?.notes ?? [];
    el.innerHTML = renderSpecNotes(notes);
    el.classList.toggle('hidden', notes.length === 0);
  }

  /**
   * Open a non-spec `.txt` entry as a read-only grid. The worker parses only
   * the rows shown; the entry stays untouched, so export writes it verbatim.
   */
  private async openFileGrid(fileName: string): Promise<void> {
    const feed = this.feed;
    if (!feed) {
      return;
    }
    this.tableData = null;
    this.closeOverlayTable();
    if (this.clusterize) {
      this.clusterize.destroy();
      this.clusterize = null;
    }
    this.currentFile = fileName;
    const fileNameElement = document.getElementById('current-file-name');
    if (fileNameElement) {
      fileNameElement.textContent = fileName;
    }
    const notes = document.getElementById('file-spec-notes');
    if (notes) {
      notes.textContent = t('files.readOnlyNote');
      notes.classList.remove('hidden');
    }
    document.getElementById('raw-editor-view')?.classList.add('hidden');
    document.getElementById('table-editor-view')?.classList.remove('hidden');
    const container = document.getElementById('table-editor');
    if (!container) {
      return;
    }
    container.innerHTML = `<div class="p-4 text-center">${t('files.loadingTable')}</div>`;

    const table = await feed.fileTable(fileName, CONFIG.FILES_GRID_MAX_ROWS);
    if (this.currentFile !== fileName) {
      console.log(`[Editor] ${fileName}: closed before it parsed, dropped`);
      return;
    }
    if (!table || table.header.length === 0) {
      container.innerHTML = `<div class="p-4 text-center text-gray-500">${t('files.noData')}</div>`;
      return;
    }
    if (table.total > table.rows.length) {
      notify.info(
        t('files.firstRows', {
          shown: formatNumber(table.rows.length),
          total: formatNumber(table.total),
        })
      );
    }

    container.innerHTML = `
      <div class="clusterize-scroll h-full overflow-auto" id="scrollArea">
        <table class="clusterize-table" id="table">
          <thead>
            <tr>${table.header.map((h) => `<th>${this.escapeHtml(h)}</th>`).join('')}</tr>
          </thead>
          <tbody class="clusterize-content" id="contentArea"></tbody>
        </table>
      </div>`;
    const rows = table.rows.map(
      (row) =>
        `<tr>${table.header
          .map(
            (_, i) =>
              `<td class="px-2 select-text"><span class="font-mono text-sm">${this.escapeHtml(row[i] ?? '')}</span></td>`
          )
          .join('')}</tr>`
    );
    this.clusterize = new Clusterize({
      rows,
      scrollId: 'scrollArea',
      contentId: 'contentArea',
      rows_in_block: CONFIG.CLUSTERIZE_ROWS_IN_BLOCK,
      blocks_in_cluster: CONFIG.CLUSTERIZE_BLOCKS_IN_CLUSTER,
      tag: 'tr',
    });
    console.log(
      `[Editor] opened ${fileName} as a read-only grid: ${rows.length} of ${table.total} rows`
    );
  }

  /**
   * Open a non-spec passthrough file as raw text.
   *
   * There is no schema to build a grid from, so saving replaces the whole
   * entry as one patch.
   */
  private openRawFile(fileName: string, rawContent: string): void {
    this.tableData = null;
    this.closeOverlayTable();
    this.currentFile = fileName;

    const fileNameElement = document.getElementById('current-file-name');
    if (fileNameElement) {
      fileNameElement.textContent = fileName;
    }

    this.renderFileNotes(fileName);

    if (this.clusterize) {
      this.clusterize.destroy();
      this.clusterize = null;
    }

    document.getElementById('table-editor-view')?.classList.add('hidden');
    const rawView = document.getElementById('raw-editor-view');
    rawView?.classList.remove('hidden');

    const textarea = document.getElementById(
      'raw-editor'
    ) as HTMLTextAreaElement | null;
    const saveButton = document.getElementById('raw-editor-save');
    const status = document.getElementById('raw-editor-status');
    if (!textarea || !saveButton) {
      console.warn('[Editor] raw editor elements missing');
      return;
    }

    textarea.value = rawContent;
    if (status) {
      status.textContent = '';
    }

    // Replace the node to drop the previous file's save handler
    const freshSave = saveButton.cloneNode(true) as HTMLElement;
    saveButton.replaceWith(freshSave);
    freshSave.addEventListener('click', async () => {
      await this.feed!.editFile(fileName, textarea.value);
      if (status) {
        status.textContent = t('files.saved', { name: fileName });
      }
    });

    console.log('[Editor] opened passthrough file as raw text:', fileName);
  }

  async closeEditor(): Promise<void> {
    // Flush any pending database updates
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
      this.debounceTimeout = null;
    }
    await this.flushPendingUpdates();

    // Clean up Clusterize instance
    if (this.clusterize) {
      this.clusterize.destroy();
      this.clusterize = null;
    }

    // Clear pending updates
    this.pendingUpdates.clear();
    this.pendingBeforeRows.clear();
    this.currentFile = null;
    this.closeOverlayTable();
  }

  clearEditor() {
    this.currentFile = null;
    this.closeOverlayTable();

    // Clear table view
    if (this.clusterize) {
      this.clusterize.destroy();
      this.clusterize = null;
    }
    this.tableData = null;
  }

  async buildTableEditor() {
    if (!this.currentFile) {
      return;
    }

    // Show loading state
    const tableContainer = document.getElementById('table-editor');
    if (tableContainer) {
      tableContainer.innerHTML = `<div class="p-4 text-center">${t('files.loadingTable')}</div>`;
    }

    try {
      if (!this.feed) {
        return;
      }
      // Copies: cell edits write into these rows before the patch is built.
      const table = this.currentFile.replace('.txt', '');
      const data = (
        await this.feed.head(table, CONFIG.FILES_GRID_MAX_ROWS)
      ).map((row) => ({ ...row }));
      const total = (await this.feed.read('counts'))[table] ?? data.length;
      if (total > data.length) {
        console.log(
          `[Editor] ${this.currentFile}: showing ${data.length} of ${total} rows`
        );
        notify.info(
          t('files.firstRows', {
            shown: formatNumber(data.length),
            total: formatNumber(total),
          })
        );
      }

      if (!data || data.length === 0) {
        if (tableContainer) {
          tableContainer.innerHTML = `<div class="p-4 text-center text-gray-500">${t('files.noData')}</div>`;
        }
        return;
      }

      // Get headers from first row
      this.headers = Object.keys(data[0] as Record<string, unknown>);
      this.tableData = data as CSVRow[];

      // Determine which columns are PK fields (read-only)
      const tableName = this.currentFile.replace('.txt', '');
      const pkConfig = getGTFSPrimaryKey(tableName);
      let pkFields: Set<string>;
      if (pkConfig?.type === 'all_fields') {
        pkFields = new Set(this.headers);
      } else if (pkConfig?.type === 'none' || !pkConfig) {
        pkFields = new Set();
      } else {
        pkFields = new Set(pkConfig.fields);
      }

      // Create table container with proper structure for Clusterize.js
      if (tableContainer) {
        tableContainer.innerHTML = `
      <div class="clusterize-scroll h-full overflow-auto" id="scrollArea">
        <table class="clusterize-table" id="table">
          <thead>
            <tr>
              ${this.headers
                .map((header) => {
                  const description = renderSpecDescriptionPlain(
                    getGTFSFieldDescription(this.currentFile || '', header)
                  );
                  const headerText = this.escapeHtml(header);
                  return description
                    ? `<th>${createTooltip(headerText, description)}</th>`
                    : `<th>${headerText}</th>`;
                })
                .join('')}
            </tr>
          </thead>
          <tbody class="clusterize-content" id="contentArea">
          </tbody>
        </table>
      </div>
    `;

        // Generate row data for Clusterize.js
        const lockIcon =
          '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>';
        const rows = (data as CSVRow[]).map((row: CSVRow, rowIndex: number) => {
          const cells = this.headers
            .map((header) => {
              const value = row[header] || '';
              if (pkFields.has(header)) {
                return `<td class="bg-base-200 opacity-70 px-2 select-text"><span class="font-mono text-sm flex items-center gap-1">${lockIcon}${this.escapeHtml(String(value))}</span></td>`;
              }
              return `<td><input type="text" value="${this.escapeHtml(String(value))}" data-row="${rowIndex}" data-col="${header}" /></td>`;
            })
            .join('');
          return `<tr>${cells}</tr>`;
        });

        // Destroy existing Clusterize instance if it exists
        if (this.clusterize) {
          this.clusterize.destroy();
        }

        // Initialize Clusterize.js
        this.clusterize = new Clusterize({
          rows: rows,
          scrollId: 'scrollArea',
          contentId: 'contentArea',
          rows_in_block: CONFIG.CLUSTERIZE_ROWS_IN_BLOCK,
          blocks_in_cluster: CONFIG.CLUSTERIZE_BLOCKS_IN_CLUSTER,
          tag: 'tr', // Table row tag
        });

        // Add event delegation for input changes since rows are dynamically created
        const scrollArea = document.getElementById('scrollArea');
        if (scrollArea) {
          scrollArea.addEventListener('change', (e) => {
            const target = e.target as HTMLInputElement;
            if (target && target.tagName === 'INPUT' && target.dataset.row) {
              this.updateTableCell(target);
            }
          });

          // Add input event for real-time updates
          scrollArea.addEventListener('input', (e) => {
            const target = e.target as HTMLInputElement;
            if (target && target.tagName === 'INPUT' && target.dataset.row) {
              this.updateTableCell(target);
            }
          });

          // Vertical arrow / Enter navigation between rows. Horizontal movement
          // is left to native Tab, which already skips the input-less PK cells.
          scrollArea.addEventListener('keydown', (e) => {
            const target = e.target as HTMLInputElement;
            if (!target || target.tagName !== 'INPUT' || !target.dataset.row) {
              return;
            }
            const direction = keyToGridDirection(e);
            if (direction !== 'up' && direction !== 'down') {
              return;
            }
            const col = target.dataset.col;
            if (!col) {
              return;
            }
            e.preventDefault();
            const rowIndex = parseInt(target.dataset.row);
            this.focusTableCell(
              rowIndex + (direction === 'down' ? 1 : -1),
              col,
              0
            );
          });
        }
      }
    } catch (error) {
      console.error('Error building table editor:', error);
      if (tableContainer) {
        tableContainer.innerHTML = `<div class="p-4 text-center text-red-500">${t('files.tableError')}</div>`;
      }
    }
  }

  /**
   * Focus the input at (rowIndex, col), scrolling it into the rendered cluster
   * first if Clusterize has not got it in the DOM.
   */
  private focusTableCell(rowIndex: number, col: string, attempt: number): void {
    if (!this.tableData || rowIndex < 0 || rowIndex >= this.tableData.length) {
      return;
    }

    const contentArea = document.getElementById('contentArea');
    const scrollArea = document.getElementById('scrollArea');
    if (!contentArea || !scrollArea) {
      return;
    }

    const input = contentArea.querySelector<HTMLInputElement>(
      `input[data-row="${rowIndex}"][data-col="${CSS.escape(col)}"]`
    );
    if (input) {
      input.focus();
      input.select();
      input.scrollIntoView({ block: 'nearest' });
      return;
    }

    // Outside the rendered cluster: scroll toward the row and let Clusterize
    // render off its own scroll listener, then look again on the next frame.
    if (attempt >= 2) {
      console.warn(
        `[Editor] gave up focusing row ${rowIndex} col ${col} after ${attempt} scroll attempts`
      );
      return;
    }

    const ratio = rowIndex / this.tableData.length;
    scrollArea.scrollTop = Math.max(
      0,
      ratio * scrollArea.scrollHeight - scrollArea.clientHeight / 2
    );
    requestAnimationFrame(() => {
      this.focusTableCell(rowIndex, col, attempt + 1);
    });
  }

  updateTableCell(input: HTMLInputElement): void {
    const rowStr = input.dataset.row;
    const col = input.dataset.col;
    const value = input.value;

    if (!rowStr || !col || !this.tableData || !this.currentFile) {
      return;
    }

    const rowIndex = parseInt(rowStr);
    if (!this.tableData[rowIndex]) {
      return;
    }

    // Capture before state for this row before any mutation
    if (!this.pendingBeforeRows.has(rowIndex)) {
      this.pendingBeforeRows.set(rowIndex, { ...this.tableData[rowIndex] });
    }

    // Update local table data immediately for UI responsiveness
    this.tableData[rowIndex][col] = value;

    // Add visual indicator that changes are pending
    input.classList.add('pending-save');

    // Store the pending update
    const updateKey = `${rowIndex}-${col}`;
    this.pendingUpdates.set(updateKey, {
      rowIndex,
      rowData: { ...this.tableData[rowIndex] },
      originalInput: input,
    });

    // Debounce the database write
    this.debounceDatabaseUpdate();
  }

  async saveCurrentFileChanges() {
    if (!this.currentFile || !this.feed) {
      return;
    }

    await this.flushPendingUpdates();
  }

  private debounceDatabaseUpdate(): void {
    // Clear existing timeout
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
    }

    // Set new timeout
    this.debounceTimeout = setTimeout(async () => {
      await this.flushPendingUpdates();
    }, this.DEBOUNCE_DELAY);
  }

  private async flushPendingUpdates(): Promise<void> {
    if (this.pendingUpdates.size === 0 || !this.currentFile || !this.feed) {
      return;
    }

    try {
      const tableName = this.currentFile.replace('.txt', '');
      const updates = Array.from(this.pendingUpdates.values());

      // One update per edited row, all as one undo step.
      const ops = [...this.pendingBeforeRows].map(([rowIndex, before]) =>
        this.tableData
          ? updateOp(tableName, before, this.tableData[rowIndex])
          : null
      );
      await this.feed.apply(ops);

      for (const update of updates) {
        if (update.originalInput) {
          update.originalInput.classList.remove('pending-save');
          update.originalInput.classList.add('saved');

          // Remove saved indicator after a short delay
          setTimeout(() => {
            if (update.originalInput) {
              update.originalInput.classList.remove('saved');
            }
          }, 1000);
        }
      }

      // Clear pending updates
      this.pendingUpdates.clear();
      this.pendingBeforeRows.clear();

      console.log(`[Editor] saved ${updates.length} table cell updates`);
    } catch (error) {
      console.error('[Editor] saving table updates failed:', error);

      // Mark all pending inputs as having errors
      this.pendingUpdates.forEach((update) => {
        if (update.originalInput) {
          update.originalInput.classList.remove('pending-save');
          update.originalInput.classList.add('save-error');
        }
      });
    }
  }

  escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  getCurrentFile() {
    return this.currentFile;
  }
}
