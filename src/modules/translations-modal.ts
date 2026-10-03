/**
 * `translations.txt`: one sidebar entry per translatable (table, field), each
 * a matrix of its texts by language, plus "All rows", the raw rows.
 *
 * Translations are editable here but are not yet applied to any displayed
 * label: that needs a display-language selector and a lookup inside
 * `utils/entity-display.ts`, which is its own piece of work.
 */

import { showSidebarModal } from 'gtfs-zone-web-common/ui/sidebar-modal';
import { escapeHtml } from 'gtfs-zone-web-common/util/escape-html';
import {
  renderEditableTable,
  installEditableTableHandlers,
  uninstallEditableTableHandlers,
  type EditableTableConfig,
  type EditableTableDeps,
} from './editable-table';
import { emptyState } from './fares-modal';
import { showOptionPickerModal } from './option-picker-modal';
import type { GTFSParser } from './gtfs-parser';
import type { PatchManager } from './patch-manager';
import {
  MATRIX_ROW_LIMIT,
  allTranslatableFieldNames,
  buildRows,
  buildSourceIndex,
  cellText,
  countOverrides,
  coverage,
  defaultMode,
  ensureRecords,
  filterRows,
  hasRecordTranslations,
  readEntryTranslations,
  renderMatrix,
  validateTranslationRow,
  writeCell,
  type MatrixMode,
  type MatrixView,
  type SourceIndex,
  type TranslationEntry,
} from './translation-matrix';
import {
  translatableFields,
  translatableTables,
} from '../utils/translation-targets';
import { generateCompositeKeyFromRecord } from '../utils/gtfs-primary-keys';
import { specStoreName } from '../utils/spec-field-edit';
import {
  isValidLanguageCode,
  languageOptions,
} from '../utils/constrained-values';
import { GTFS_TABLES } from '../types/gtfs';
import type { PatchRecord } from '../types/patch';
import { t } from '../i18n/messages';

export interface TranslationsModalDeps extends EditableTableDeps {
  patchManager: EditableTableDeps['patchManager'] &
    Pick<PatchManager, 'on' | 'off'>;
  gtfsParser: Pick<GTFSParser, 'getFileDataSync' | 'feedGeneration'>;
}

/** Which pane to open on, and which raw row to draw attention to. */
export interface TranslationsModalTarget {
  table?: string;
  rowKey?: string;
}

const STORE = specStoreName(GTFS_TABLES.TRANSLATIONS);
const ALL_ROWS_ID = 'all-rows';
const RAW_INSTANCE_ID = 'translations-table';
const SEARCH_DEBOUNCE_MS = 200;

const INTRO = t('translations.intro');

const MATRIX_NOTE = t('translations.matrixNote');

const RAW_NOTE = t('translations.rawNote');

interface PaneFilter {
  search: string;
  untranslatedOnly: boolean;
}

/** One entry per translatable field of each table that has rows. */
function buildEntries(
  parser: TranslationsModalDeps['gtfsParser']
): TranslationEntry[] {
  const entries: TranslationEntry[] = [];
  for (const table of translatableTables()) {
    const file = `${table}.txt`;
    const rows = parser.getFileDataSync(file);
    if (rows.length === 0) {
      continue;
    }
    const fields = translatableFields(file, rows);
    if (fields.length === 0) {
      continue;
    }
    if (table === 'feed_info') {
      entries.push({ id: 'feed_info', table, file, fields });
      continue;
    }
    for (const field of fields) {
      entries.push({ id: `${table}.${field}`, table, file, fields: [field] });
    }
  }
  return entries;
}

function docLink(anchor: string): string {
  return `<a href="https://gtfs.org/documentation/schedule/reference/#${anchor}"
    target="_blank" rel="noopener noreferrer" class="link">${t('fares.reference')}</a>.`;
}

function patchTables(record: PatchRecord | undefined): string[] {
  if (!record) {
    return [];
  }
  const { patch } = record;
  return patch.op === 'batch'
    ? patch.ops.map((op) => op.source.table)
    : [patch.source.table];
}

export async function showTranslationsModal(
  deps: TranslationsModalDeps,
  target: TranslationsModalTarget = {}
): Promise<void> {
  const parser = deps.gtfsParser;
  const entries = buildEntries(parser);

  // Consumed by the first raw render only: a later refresh must not re-scroll.
  let pendingRowKey = target.rowKey;
  const initialId = target.rowKey ? ALL_ROWS_ID : target.table;

  // Modal state: dropped on close.
  const sourceIndexes = new Map<string, SourceIndex>();
  const modes = new Map<string, MatrixMode>();
  const filters = new Map<string, PaneFilter>();
  const pendingLanguages = new Set<string>();
  // Bumped on every patch, so the translation scans below are re-read.
  let version = 0;
  let scan: {
    version: number;
    counts: Map<string, number>;
    languages: string[];
  } | null = null;

  // The matrix of the pane on screen, for its event handlers.
  let currentView: MatrixView | null = null;
  // Cell to open once the next render lands, after a Tab commit.
  let pendingFocus: { key: string; lang: string } | null = null;
  // A cell write is in flight; a click on another cell waits for it.
  let committing = false;
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let rawRows: Record<string, unknown>[] = [];

  const refreshRef = { refresh: async (): Promise<void> => {} };

  const filterFor = (id: string): PaneFilter => {
    let filter = filters.get(id);
    if (!filter) {
      filter = { search: '', untranslatedOnly: false };
      filters.set(id, filter);
    }
    return filter;
  };

  /** Counts per entry and the languages in use, one pass per patch. */
  const scanTranslations = (): NonNullable<typeof scan> => {
    if (scan && scan.version === version) {
      return scan;
    }
    const counts = new Map<string, number>();
    const languages = new Set<string>();
    for (const row of parser.getFileDataSync(GTFS_TABLES.TRANSLATIONS)) {
      const table = String(row.table_name ?? '');
      const id =
        table === 'feed_info'
          ? 'feed_info'
          : `${table}.${String(row.field_name ?? '')}`;
      counts.set(id, (counts.get(id) ?? 0) + 1);
      const language = String(row.language ?? '');
      if (language !== '') {
        languages.add(language);
      }
    }
    scan = { version, counts, languages: [...languages].sort() };
    return scan;
  };

  const onPatch =
    (event: 'change' | 'undo' | 'redo' | 'jump') =>
    (record?: PatchRecord): void => {
      version++;
      const tables = patchTables(record);
      if (tables.length === 0 || tables.some((table) => table !== STORE)) {
        sourceIndexes.clear();
      }
      if (event !== 'change') {
        console.log(`[Translations] ${event}, refreshing`);
        void refreshRef.refresh();
      }
    };
  const listeners = {
    change: onPatch('change'),
    undo: onPatch('undo'),
    redo: onPatch('redo'),
    jump: onPatch('jump'),
  };

  // ─── Matrix pane ───────────────────────────────────────────────────────────

  const sourceIndexFor = async (
    entry: TranslationEntry
  ): Promise<SourceIndex | null> => {
    if (entry.id === 'feed_info') {
      return null;
    }
    const cached = sourceIndexes.get(entry.id);
    if (cached && cached.feedGeneration === parser.feedGeneration) {
      return cached;
    }
    const index = await buildSourceIndex(
      entry,
      parser.getFileDataSync(entry.file),
      parser.feedGeneration
    );
    sourceIndexes.set(entry.id, index);
    return index;
  };

  const buildView = async (entry: TranslationEntry): Promise<MatrixView> => {
    const index = await sourceIndexFor(entry);
    let mode = modes.get(entry.id);
    if (!mode) {
      mode = index ? defaultMode(entry, index) : 'value';
      modes.set(entry.id, mode);
    }
    const translations = readEntryTranslations(
      parser.getFileDataSync(GTFS_TABLES.TRANSLATIONS),
      entry
    );
    if (index && (mode === 'record' || hasRecordTranslations(translations))) {
      await ensureRecords(entry, index, parser.getFileDataSync(entry.file));
    }
    const feedInfo = parser.getFileDataSync(GTFS_TABLES.FEED_INFO)[0];

    const languages = scanTranslations().languages;
    for (const lang of [...pendingLanguages]) {
      if (languages.includes(lang)) {
        pendingLanguages.delete(lang);
      }
    }
    return {
      entry,
      mode,
      rows: buildRows(entry, mode, index, feedInfo),
      languages: [...languages, ...pendingLanguages],
      pending: new Set(pendingLanguages),
      feedLang: String(feedInfo?.feed_lang ?? ''),
      translations,
      overrides: index ? countOverrides(translations, index) : new Map(),
    };
  };

  const renderToolbar = (view: MatrixView): string => {
    const filter = filterFor(view.entry.id);
    const modeSwitch =
      view.entry.id === 'feed_info'
        ? ''
        : `<div class="join">
            ${(['value', 'record'] as const)
              .map(
                (mode) =>
                  `<button type="button" class="btn btn-xs join-item ${view.mode === mode ? 'btn-active' : ''}" data-tr-mode="${mode}">${mode === 'value' ? t('translations.byValue') : t('translations.byRecord')}</button>`
              )
              .join('')}
          </div>`;
    const covered = coverage(view);
    const total = view.rows.length;
    const chips = view.languages
      .map(
        (lang) =>
          `<span class="badge badge-ghost badge-sm whitespace-nowrap">${escapeHtml(t('translations.coverage', { lang, done: covered.get(lang) ?? 0, total }))}</span>`
      )
      .join('');
    return `
      <div class="flex flex-wrap items-center gap-3 mb-2">
        ${modeSwitch}
        <input type="search" class="input input-sm w-64" data-tr-search
               placeholder="${t('translations.search')}" autocomplete="off"
               value="${escapeHtml(filter.search)}">
        <label class="label text-sm gap-2 cursor-pointer">
          <input type="checkbox" class="checkbox checkbox-sm" data-tr-untranslated
                 ${filter.untranslatedOnly ? 'checked' : ''}>
          ${t('translations.untranslatedOnly')}
        </label>
      </div>
      <div class="flex flex-wrap gap-1 mb-2">${chips}</div>`;
  };

  const renderMatrixBody = (view: MatrixView): string => {
    const filter = filterFor(view.entry.id);
    return renderMatrix(
      view,
      filterRows(view, filter.search, filter.untranslatedOnly)
    );
  };

  const renderMatrixPane = async (entry: TranslationEntry): Promise<string> => {
    const started = performance.now();
    const view = await buildView(entry);
    currentView = view;
    const html = `${renderToolbar(view)}<div data-tr-matrix>${renderMatrixBody(view)}</div>`;
    console.log(
      `[Translations] rendered ${entry.id} (${view.mode}, ${view.rows.length} rows) in ${Math.round(performance.now() - started)} ms`
    );
    return html;
  };

  const redrawMatrix = (paneEl: HTMLElement): void => {
    const container = paneEl.querySelector('[data-tr-matrix]');
    if (container && currentView) {
      container.innerHTML = renderMatrixBody(currentView);
    }
  };

  const addLanguage = async (): Promise<void> => {
    const picked = await showOptionPickerModal({
      title: t('translations.addLanguage'),
      options: languageOptions(),
      searchable: true,
      placeholder: t('translations.searchLanguages'),
    });
    if (picked === null) {
      return;
    }
    if (!isValidLanguageCode(picked)) {
      console.warn(`[Translations] not a language code: ${picked}`);
      return;
    }
    if (currentView?.languages.includes(picked)) {
      console.warn(`[Translations] ${picked} is already a column`);
      return;
    }
    console.log(`[Translations] pending language ${picked}`);
    pendingLanguages.add(picked);
    await refreshRef.refresh();
  };

  /** The language cell after (or before) this one, in reading order. */
  const neighbourCell = (
    paneEl: HTMLElement,
    td: HTMLElement,
    backwards: boolean
  ): { key: string; lang: string } | null => {
    const cells = [...paneEl.querySelectorAll<HTMLElement>('td[data-tr-lang]')];
    const next = cells[cells.indexOf(td) + (backwards ? -1 : 1)];
    return next
      ? { key: next.dataset.trKey ?? '', lang: next.dataset.trLang ?? '' }
      : null;
  };

  const findCell = (
    paneEl: HTMLElement,
    key: string,
    lang: string
  ): HTMLElement | null =>
    [...paneEl.querySelectorAll<HTMLElement>('td[data-tr-lang]')].find(
      (td) => td.dataset.trKey === key && td.dataset.trLang === lang
    ) ?? null;

  const openEditor = (paneEl: HTMLElement, td: HTMLElement): void => {
    const view = currentView;
    const key = td.dataset.trKey;
    const lang = td.dataset.trLang;
    if (!view || key === undefined || lang === undefined) {
      return;
    }
    if (td.querySelector('input')) {
      return;
    }
    const text = cellText(view, key, lang);
    const restore = td.innerHTML;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'input input-xs w-full';
    input.value = text.own;
    input.placeholder = text.inherited;
    td.replaceChildren(input);
    input.focus();

    let done = false;
    const commit = async (
      move: 'stay' | 'next' | 'prev',
      fromBlur = false
    ): Promise<void> => {
      if (done) {
        return;
      }
      done = true;
      committing = true;
      const next =
        move === 'stay' ? null : neighbourCell(paneEl, td, move === 'prev');
      const result = await writeCell(deps, view, key, lang, input.value);
      committing = false;
      if (result !== null && result !== 'unchanged') {
        done = false;
        pendingFocus = null;
        input.classList.add('input-error');
        input.title = result;
        console.warn(`[Translations] rejected ${key} ${lang}: ${result}`);
        // Refocusing on blur fights the element that took focus, in a loop.
        if (!fromBlur) {
          input.focus();
        }
        return;
      }
      // A cell clicked while this one was committing lands in pendingFocus.
      pendingFocus = next ?? pendingFocus;
      if (result === 'unchanged') {
        td.innerHTML = restore;
        const target = pendingFocus;
        pendingFocus = null;
        const cell = target && findCell(paneEl, target.key, target.lang);
        if (cell) {
          openEditor(paneEl, cell);
        }
        return;
      }
      await refreshRef.refresh();
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void commit('stay');
      } else if (e.key === 'Escape') {
        // The modal closes on Escape otherwise.
        e.preventDefault();
        e.stopPropagation();
        done = true;
        td.innerHTML = restore;
      } else if (e.key === 'Tab') {
        e.preventDefault();
        void commit(e.shiftKey ? 'prev' : 'next');
      }
    });
    input.addEventListener('blur', () => void commit('stay', true));
  };

  const wireMatrixPane = (
    paneEl: HTMLElement,
    entry: TranslationEntry
  ): void => {
    const filter = filterFor(entry.id);

    paneEl.addEventListener('click', (e) => {
      const el = e.target as HTMLElement;
      const modeBtn = el.closest<HTMLElement>('[data-tr-mode]');
      if (modeBtn) {
        const mode = modeBtn.dataset.trMode as MatrixMode;
        if (mode !== modes.get(entry.id)) {
          console.log(`[Translations] ${entry.id} by ${mode}`);
          modes.set(entry.id, mode);
          void refreshRef.refresh();
        }
        return;
      }
      if (el.closest('[data-tr-add-lang]')) {
        void addLanguage();
      }
    });

    // Cells open on mousedown: a commit's re-render can land before the click,
    // which then has no cell to target.
    paneEl.addEventListener('mousedown', (e) => {
      const el = e.target as HTMLElement;
      const td = el.closest<HTMLElement>('td[data-tr-lang]');
      if (e.button !== 0 || !td || el.closest('input')) {
        return;
      }
      e.preventDefault();
      const cell = {
        key: td.dataset.trKey ?? '',
        lang: td.dataset.trLang ?? '',
      };
      const open = paneEl.querySelector<HTMLInputElement>(
        'td[data-tr-lang] input'
      );
      if (open) {
        // The blur commits, then opens pendingFocus.
        pendingFocus = cell;
        open.blur();
        return;
      }
      if (committing) {
        pendingFocus = cell;
        return;
      }
      openEditor(paneEl, td);
    });

    paneEl
      .querySelector('[data-tr-untranslated]')
      ?.addEventListener('change', (e) => {
        filter.untranslatedOnly = (e.target as HTMLInputElement).checked;
        redrawMatrix(paneEl);
      });

    paneEl.querySelector('[data-tr-search]')?.addEventListener('input', (e) => {
      const value = (e.target as HTMLInputElement).value;
      if (searchTimer !== null) {
        clearTimeout(searchTimer);
      }
      searchTimer = setTimeout(() => {
        searchTimer = null;
        filter.search = value;
        redrawMatrix(paneEl);
      }, SEARCH_DEBOUNCE_MS);
    });

    if (pendingFocus) {
      const { key, lang } = pendingFocus;
      pendingFocus = null;
      const cell = findCell(paneEl, key, lang);
      if (cell) {
        openEditor(paneEl, cell);
      }
    }
  };

  // ─── All rows pane ─────────────────────────────────────────────────────────

  const rawConfig: EditableTableConfig = {
    instanceId: RAW_INSTANCE_ID,
    tableName: GTFS_TABLES.TRANSLATIONS,
    rows: [],
    deps,
    emptyMessage: emptyState(GTFS_TABLES.TRANSLATIONS, t('translations.hint')),
    columnOverrides: {
      field_name: {
        suggestions: () => Promise.resolve(allTranslatableFieldNames()),
      },
      translation: { widthClass: 'min-w-48' },
      field_value: { widthClass: 'min-w-48' },
    },
    validateRow: validateTranslationRow,
    onInsert: () => void refreshRef.refresh(),
    onRowsChanged: () => void refreshRef.refresh(),
    onDelete: () => void refreshRef.refresh(),
  };

  /** Rows matching the search, capped, with a deep-linked row kept in. */
  const rawShown = (): { rows: Record<string, unknown>[]; matches: number } => {
    const needle = filterFor(ALL_ROWS_ID).search.trim().toLowerCase();
    const matches = needle
      ? rawRows.filter((row) =>
          Object.values(row).some((value) =>
            String(value ?? '')
              .toLowerCase()
              .includes(needle)
          )
        )
      : rawRows;
    const rows = matches.slice(0, MATRIX_ROW_LIMIT);
    if (pendingRowKey) {
      const target = matches.find(
        (row) => generateCompositeKeyFromRecord(STORE, row) === pendingRowKey
      );
      if (target && !rows.includes(target)) {
        rows.unshift(target);
      }
    }
    return { rows, matches: matches.length };
  };

  const renderRawTable = async (): Promise<string> => {
    const { rows, matches } = rawShown();
    rawConfig.rows = rows;
    const more =
      matches > rows.length
        ? `<p class="text-sm opacity-60 py-2">${t('translations.more', { count: matches - rows.length })}</p>`
        : '';
    return (await renderEditableTable(rawConfig)) + more;
  };

  const renderRawPane = async (): Promise<string> => {
    rawRows = await deps.gtfsDatabase.getAllRows(STORE);
    const filter = filterFor(ALL_ROWS_ID);
    return `
      <div class="flex items-center gap-3 mb-2">
        <input type="search" class="input input-sm w-64" data-tr-raw-search
               placeholder="${t('translations.searchAll')}" autocomplete="off"
               value="${escapeHtml(filter.search)}">
      </div>
      <div data-tr-raw>${await renderRawTable()}</div>`;
  };

  const wireRawPane = (paneEl: HTMLElement): void => {
    paneEl
      .querySelector('[data-tr-raw-search]')
      ?.addEventListener('input', (e) => {
        const value = (e.target as HTMLInputElement).value;
        if (searchTimer !== null) {
          clearTimeout(searchTimer);
        }
        searchTimer = setTimeout(() => {
          searchTimer = null;
          filterFor(ALL_ROWS_ID).search = value;
          void renderRawTable().then((html) => {
            const container = paneEl.querySelector('[data-tr-raw]');
            if (container) {
              container.innerHTML = html;
            }
          });
        }, SEARCH_DEBOUNCE_MS);
      });

    if (!pendingRowKey) {
      return;
    }
    const rowKey = pendingRowKey;
    pendingRowKey = undefined;
    const row = paneEl.querySelector(`[data-et-row="${CSS.escape(rowKey)}"]`);
    if (row instanceof HTMLElement) {
      row.scrollIntoView({ block: 'center' });
      row.classList.add('bg-primary/10');
    } else {
      console.warn(`[Translations] no row for ${rowKey}`);
    }
  };

  // ─── Modal ─────────────────────────────────────────────────────────────────

  let activeEntry: TranslationEntry | null = null;

  installEditableTableHandlers(rawConfig);
  for (const [event, listener] of Object.entries(listeners)) {
    deps.patchManager.on(event as keyof typeof listeners, listener);
  }

  try {
    await showSidebarModal({
      title: t('translations.title'),
      intro: INTRO,
      initialId,
      refreshRef,
      boxClassName: 'max-w-7xl w-11/12',
      entries: [
        ...entries.map((entry) => ({
          id: entry.id,
          group: entry.file,
          label:
            entry.id === 'feed_info'
              ? t('translations.allFields')
              : entry.fields[0],
          paneTitle:
            entry.id === 'feed_info'
              ? entry.file
              : `${entry.file}: ${entry.fields[0]}`,
          note: `${escapeHtml(MATRIX_NOTE)} ${docLink('translationstxt')}`,
          count: () =>
            Promise.resolve(scanTranslations().counts.get(entry.id) ?? 0),
          renderPane: () => {
            activeEntry = entry;
            return renderMatrixPane(entry);
          },
        })),
        {
          id: ALL_ROWS_ID,
          group: 'translations.txt',
          label: t('translations.allRows'),
          note: `${escapeHtml(RAW_NOTE)} ${docLink('translationstxt')}`,
          count: () =>
            Promise.resolve(
              parser.getFileDataSync(GTFS_TABLES.TRANSLATIONS).length
            ),
          renderPane: () => {
            activeEntry = null;
            currentView = null;
            return renderRawPane();
          },
        },
      ],
      onPaneRendered: (paneEl) => {
        if (activeEntry) {
          wireMatrixPane(paneEl, activeEntry);
        } else {
          wireRawPane(paneEl);
        }
      },
    });
  } finally {
    if (searchTimer !== null) {
      clearTimeout(searchTimer);
    }
    for (const [event, listener] of Object.entries(listeners)) {
      deps.patchManager.off(event as keyof typeof listeners, listener);
    }
    uninstallEditableTableHandlers(RAW_INSTANCE_ID);
    if (pendingLanguages.size > 0) {
      console.log(
        `[Translations] dropped empty languages ${[...pendingLanguages].join(', ')}`
      );
    }
  }
}
