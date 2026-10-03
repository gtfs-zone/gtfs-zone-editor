/**
 * The translations matrix: one row per translatable thing of one
 * (table, field), one column per language.
 *
 * Builds the source index from the live table, looks up the translations that
 * apply to it, renders the grid, and writes a cell back to `translations.txt`
 * through the patch system.
 */

import { escapeHtml } from 'gtfs-zone-web-common/util/escape-html';
import type { EditableTableDeps } from './editable-table';
import { getEntityDisplay } from '../utils/entity-display';
import { extensionFieldSpec } from '../utils/extension-fields';
import { generateCompositeKeyFromRecord } from '../utils/gtfs-primary-keys';
import { patchUpdate } from '../utils/patch-utils';
import { specStoreName, validateFieldValue } from '../utils/spec-field-edit';
import { yieldToEventLoop } from '../utils/async-yield';
import {
  translatableFields,
  translatableTables,
  translationRecordFields,
} from '../utils/translation-targets';
import { GTFS_FIELD_SPECS, GTFS_TABLES } from '../types/gtfs';

export type MatrixMode = 'value' | 'record';

/** One sidebar entry: a (table, field), or every field of feed_info. */
export interface TranslationEntry {
  /** `stops.stop_name`, or `feed_info`. */
  id: string;
  /** Store name, as `table_name` holds it: `stops`. */
  table: string;
  /** File name: `stops.txt`. */
  file: string;
  /** The translated field, or every translatable field for feed_info. */
  fields: string[];
}

/** One record of the source table, as far as the matrix needs it. */
interface SourceRecord {
  id: string;
  sub: string;
  key: string;
  value: string;
  label: string;
}

/** Strings copied out of the live source table for one entry. */
export interface SourceIndex {
  feedGeneration: number;
  /** Non-empty source value -> how many records hold it. */
  byValue: Map<string, number>;
  nonEmpty: number;
  /** Built on first need: by record mode, or a by value override count. */
  records: SourceRecord[] | null;
  valueByRecord: Map<string, string> | null;
}

/** The translations naming one entry, copied out, per language. */
interface EntryTranslations {
  byValue: Map<string, Map<string, Record<string, unknown>>>;
  byRecord: Map<string, Map<string, Record<string, unknown>>>;
  byField: Map<string, Map<string, Record<string, unknown>>>;
}

/** One rendered row of the matrix. */
export interface MatrixRow {
  key: string;
  original: string;
  usedBy?: number;
  record?: { id: string; sub: string; label: string };
  /** The feed_info field this row is. */
  field?: string;
}

export interface MatrixView {
  entry: TranslationEntry;
  mode: MatrixMode;
  rows: MatrixRow[];
  languages: string[];
  pending: Set<string>;
  feedLang: string;
  translations: EntryTranslations;
  /** Language -> source value -> records overriding that value. */
  overrides: Map<string, Map<string, number>>;
}

/** What a cell shows and what writing it starts from. */
interface CellState {
  own: Record<string, unknown> | undefined;
  inherited: string;
  overrides: number;
}

const TRANSLATIONS_STORE = specStoreName(GTFS_TABLES.TRANSLATIONS);
const YIELD_EVERY_ROWS = 50_000;
export const MATRIX_ROW_LIMIT = 300;

function str(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

function recordKey(id: string, sub: string): string {
  return `${id}\u0000${sub}`;
}

// ─── Spec derivation ──────────────────────────────────────────────────────────

/** Every field name any translatable table could name, for suggestions. */
export function allTranslatableFieldNames(): string[] {
  const names = new Set<string>();
  for (const table of translatableTables()) {
    for (const field of translatableFields(`${table}.txt`, [])) {
      names.add(field);
    }
  }
  return [...names].sort();
}

function fieldSpec(file: string, field: string) {
  return GTFS_FIELD_SPECS[file]?.[field] ?? extensionFieldSpec(field);
}

// ─── Cross-field rules ────────────────────────────────────────────────────────

/**
 * A translation names its target either by record or by value, never both.
 *
 * `feed_info` has a single row, so it has nothing to name and both referencing
 * forms are forbidden there.
 */
export function validateTranslationRow(
  row: Record<string, unknown>
): string | null {
  const cell = (field: string): string => str(row[field]).trim();
  const tableName = cell('table_name');
  const recordId = cell('record_id');
  const recordSubId = cell('record_sub_id');
  const fieldValue = cell('field_value');

  if (tableName === 'feed_info') {
    for (const [field, value] of [
      ['record_id', recordId],
      ['record_sub_id', recordSubId],
      ['field_value', fieldValue],
    ]) {
      if (value !== '') {
        return `${field} is forbidden when table_name is feed_info`;
      }
    }
    return null;
  }

  if (recordId !== '' && fieldValue !== '') {
    return 'record_id and field_value are mutually exclusive: set one or the other';
  }
  if (recordId === '' && fieldValue === '') {
    return 'Either record_id or field_value is required';
  }
  if (recordSubId !== '' && recordId === '') {
    return 'record_sub_id requires record_id';
  }
  if (tableName === 'stop_times' && recordId !== '' && recordSubId === '') {
    return 'record_sub_id (the stop_sequence) is required when translating stop_times by record_id';
  }
  return null;
}

// ─── Source index ─────────────────────────────────────────────────────────────

/** Count the distinct non-empty values of the entry's field. */
export async function buildSourceIndex(
  entry: TranslationEntry,
  rows: Record<string, unknown>[],
  feedGeneration: number
): Promise<SourceIndex> {
  const started = performance.now();
  const field = entry.fields[0];
  const byValue = new Map<string, number>();
  let nonEmpty = 0;
  for (let i = 0; i < rows.length; i++) {
    if (i > 0 && i % YIELD_EVERY_ROWS === 0) {
      await yieldToEventLoop();
    }
    const value = str(rows[i][field]);
    if (value === '') {
      continue;
    }
    nonEmpty++;
    byValue.set(value, (byValue.get(value) ?? 0) + 1);
  }
  console.log(
    `[Translations] indexed ${entry.id}: ${byValue.size} values over ${nonEmpty} records in ${Math.round(performance.now() - started)} ms`
  );
  return {
    feedGeneration,
    byValue,
    nonEmpty,
    records: null,
    valueByRecord: null,
  };
}

/** List the records holding a non-empty value, once per index. */
export async function ensureRecords(
  entry: TranslationEntry,
  index: SourceIndex,
  rows: Record<string, unknown>[]
): Promise<void> {
  if (index.records) {
    return;
  }
  const started = performance.now();
  const ids = translationRecordFields(entry.table);
  const field = entry.fields[0];
  const records: SourceRecord[] = [];
  const valueByRecord = new Map<string, string>();
  let unnamed = 0;
  for (let i = 0; i < rows.length; i++) {
    if (i > 0 && i % YIELD_EVERY_ROWS === 0) {
      await yieldToEventLoop();
    }
    const row = rows[i];
    const value = str(row[field]);
    if (value === '') {
      continue;
    }
    const id = ids ? str(row[ids.id]) : '';
    if (id === '') {
      unnamed++;
      continue;
    }
    const sub = ids?.sub ? str(row[ids.sub]) : '';
    const key = recordKey(id, sub);
    const display = getEntityDisplay(
      entry.table,
      row as Record<string, string>
    ).primary;
    records.push({
      id,
      sub,
      key,
      value,
      label: display !== id ? str(display) : '',
    });
    valueByRecord.set(key, value);
  }
  index.records = records;
  index.valueByRecord = valueByRecord;
  if (unnamed > 0) {
    console.warn(
      `[Translations] ${entry.id}: ${unnamed} records have no ${ids?.id ?? 'record id'} and can only be translated by value`
    );
  }
  console.log(
    `[Translations] listed ${records.length} records of ${entry.id} in ${Math.round(performance.now() - started)} ms`
  );
}

/** By value when values repeat, by record when they are mostly unique. */
export function defaultMode(
  entry: TranslationEntry,
  index: SourceIndex
): MatrixMode {
  if (entry.table === 'stop_times') {
    return 'value';
  }
  return index.byValue.size < index.nonEmpty / 2 ? 'value' : 'record';
}

// ─── Translation lookup ───────────────────────────────────────────────────────

/** Copy out the translations naming this entry, in one pass. */
export function readEntryTranslations(
  translations: Record<string, unknown>[],
  entry: TranslationEntry
): EntryTranslations {
  const result: EntryTranslations = {
    byValue: new Map(),
    byRecord: new Map(),
    byField: new Map(),
  };
  const add = (
    map: Map<string, Map<string, Record<string, unknown>>>,
    language: string,
    key: string,
    row: Record<string, unknown>
  ): void => {
    let byKey = map.get(language);
    if (!byKey) {
      byKey = new Map();
      map.set(language, byKey);
    }
    byKey.set(key, { ...row });
  };

  const fields = new Set(entry.fields);
  for (const row of translations) {
    if (str(row.table_name) !== entry.table) {
      continue;
    }
    const field = str(row.field_name);
    if (!fields.has(field)) {
      continue;
    }
    const language = str(row.language);
    if (entry.id === 'feed_info') {
      add(result.byField, language, field, row);
      continue;
    }
    const recordId = str(row.record_id);
    if (recordId !== '') {
      add(
        result.byRecord,
        language,
        recordKey(recordId, str(row.record_sub_id)),
        row
      );
    } else {
      add(result.byValue, language, str(row.field_value), row);
    }
  }
  return result;
}

/** Count record overrides of each by value row, per language. */
export function countOverrides(
  translations: EntryTranslations,
  index: SourceIndex
): Map<string, Map<string, number>> {
  const result = new Map<string, Map<string, number>>();
  for (const [language, byKey] of translations.byRecord) {
    const counts = new Map<string, number>();
    for (const key of byKey.keys()) {
      const value = index.valueByRecord?.get(key);
      if (value !== undefined) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
    }
    result.set(language, counts);
  }
  return result;
}

/** Whether any translation of the entry names a record. */
export function hasRecordTranslations(
  translations: EntryTranslations
): boolean {
  return [...translations.byRecord.values()].some((byKey) => byKey.size > 0);
}

// ─── Rows ─────────────────────────────────────────────────────────────────────

export function buildRows(
  entry: TranslationEntry,
  mode: MatrixMode,
  index: SourceIndex | null,
  feedInfo: Record<string, unknown> | undefined
): MatrixRow[] {
  if (entry.id === 'feed_info') {
    return entry.fields
      .map((field) => ({
        key: field,
        field,
        original: str(feedInfo?.[field]),
      }))
      .filter((row) => row.original !== '');
  }
  if (!index) {
    return [];
  }
  if (mode === 'value') {
    return [...index.byValue.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([value, count]) => ({
        key: value,
        original: value,
        usedBy: count,
      }));
  }
  return (index.records ?? []).map((record) => ({
    key: record.key,
    original: record.value,
    record: { id: record.id, sub: record.sub, label: record.label },
  }));
}

function cellState(
  view: MatrixView,
  row: MatrixRow,
  language: string
): CellState {
  const { translations } = view;
  if (view.entry.id === 'feed_info') {
    return {
      own: translations.byField.get(language)?.get(row.key),
      inherited: '',
      overrides: 0,
    };
  }
  const byValue = translations.byValue.get(language)?.get(row.original);
  if (view.mode === 'value') {
    return {
      own: byValue,
      inherited: '',
      overrides: view.overrides.get(language)?.get(row.original) ?? 0,
    };
  }
  return {
    own: translations.byRecord.get(language)?.get(row.key),
    inherited: str(byValue?.translation),
    overrides: 0,
  };
}

/** The text a cell shows, own or inherited. */
function shownText(view: MatrixView, row: MatrixRow, language: string): string {
  const cell = cellState(view, row, language);
  return cell.own ? str(cell.own.translation) : cell.inherited;
}

/** Translated languages per language: rows with own or inherited text. */
export function coverage(view: MatrixView): Map<string, number> {
  const result = new Map<string, number>();
  for (const language of view.languages) {
    let n = 0;
    for (const row of view.rows) {
      if (shownText(view, row, language) !== '') {
        n++;
      }
    }
    result.set(language, n);
  }
  return result;
}

/** Rows matching the search, and missing a language when asked to. */
export function filterRows(
  view: MatrixView,
  search: string,
  untranslatedOnly: boolean
): MatrixRow[] {
  const needle = search.trim().toLowerCase();
  return view.rows.filter((row) => {
    if (
      untranslatedOnly &&
      view.languages.every((lang) => shownText(view, row, lang) !== '')
    ) {
      return false;
    }
    if (needle === '') {
      return true;
    }
    const haystack = [
      row.original,
      row.record?.id ?? '',
      row.record?.label ?? '',
      row.field ?? '',
      ...view.languages.map((lang) => shownText(view, row, lang)),
    ];
    return haystack.some((text) => text.toLowerCase().includes(needle));
  });
}

// ─── Render ───────────────────────────────────────────────────────────────────

function renderHeader(view: MatrixView): string {
  const original = `Original${view.feedLang ? ` (${escapeHtml(view.feedLang)})` : ''}`;
  const lead =
    view.entry.id === 'feed_info'
      ? `<th>Field</th><th>${original}</th>`
      : view.mode === 'value'
        ? `<th>${original}</th><th class="whitespace-nowrap">Used by</th>`
        : `<th>Record</th><th>${original}</th>`;
  const languages = view.languages
    .map((lang) => {
      const pending = view.pending.has(lang);
      const title =
        lang === view.feedLang
          ? `Same as feed_lang: these translations override the original text for ${lang}`
          : pending
            ? 'New language: it is kept once a cell in it is filled'
            : lang;
      const cls = pending ? 'border-dashed border-2 border-warning' : '';
      return `<th class="${cls}" title="${escapeHtml(title)}">${escapeHtml(lang)}${lang === view.feedLang ? ' *' : ''}</th>`;
    })
    .join('');
  return `<tr>${lead}${languages}<th class="w-0"><button type="button" class="btn btn-xs btn-ghost" data-tr-add-lang title="Add a language">+</button></th></tr>`;
}

function renderLead(view: MatrixView, row: MatrixRow): string {
  const original = `<td class="min-w-48 max-w-96 break-words">${escapeHtml(row.original)}</td>`;
  if (view.entry.id === 'feed_info') {
    return `<td class="font-mono text-xs">${escapeHtml(row.field ?? '')}</td>${original}`;
  }
  if (view.mode === 'value') {
    return `${original}<td class="text-right tabular-nums">${row.usedBy ?? 0}</td>`;
  }
  const record = row.record!;
  const id = record.sub ? `${record.id} / ${record.sub}` : record.id;
  const label = record.label
    ? `<div class="text-xs opacity-60">${escapeHtml(record.label)}</div>`
    : '';
  return `<td><div class="font-mono text-xs">${escapeHtml(id)}</div>${label}</td>${original}`;
}

function renderCell(
  view: MatrixView,
  row: MatrixRow,
  language: string
): string {
  const cell = cellState(view, row, language);
  const pending = view.pending.has(language) ? ' bg-warning/5' : '';
  let content = '';
  if (cell.own) {
    content = escapeHtml(str(cell.own.translation));
  } else if (cell.inherited) {
    content = `<span class="opacity-50" title="From the by value translation; typing here overrides it for this record">${escapeHtml(cell.inherited)}</span>`;
  }
  if (cell.overrides > 0) {
    content += ` <span class="badge badge-warning badge-xs whitespace-nowrap" title="Records with their own translation, which takes precedence">${cell.overrides} override${cell.overrides === 1 ? '' : 's'}</span>`;
  }
  return `<td class="min-w-40 cursor-text hover:bg-base-200${pending}" data-tr-key="${escapeHtml(row.key)}" data-tr-lang="${escapeHtml(language)}">${content}</td>`;
}

/** The grid for the rows that passed the filter, capped. */
export function renderMatrix(view: MatrixView, shown: MatrixRow[]): string {
  if (view.rows.length === 0) {
    return `<p class="text-sm opacity-60 py-4">No record has a value in this field.</p>`;
  }
  if (shown.length === 0) {
    return `<p class="text-sm opacity-60 py-4">No row matches.</p>`;
  }
  const body = shown
    .slice(0, MATRIX_ROW_LIMIT)
    .map(
      (row) =>
        `<tr>${renderLead(view, row)}${view.languages.map((lang) => renderCell(view, row, lang)).join('')}<td></td></tr>`
    )
    .join('');
  const more =
    shown.length > MATRIX_ROW_LIMIT
      ? `<p class="text-sm opacity-60 py-2">${shown.length - MATRIX_ROW_LIMIT} more, refine the search.</p>`
      : '';
  return `<div class="overflow-x-auto"><table class="table table-sm">
    <thead>${renderHeader(view)}</thead>
    <tbody>${body}</tbody>
  </table></div>${more}`;
}

// ─── Write ────────────────────────────────────────────────────────────────────

/**
 * Write one cell. An empty value deletes the cell's own translation. Returns
 * an error message, `'unchanged'` when nothing was written, or null.
 */
export async function writeCell(
  deps: EditableTableDeps,
  view: MatrixView,
  rowKey: string,
  language: string,
  raw: string
): Promise<string | 'unchanged' | null> {
  const row = view.rows.find((candidate) => candidate.key === rowKey);
  if (!row) {
    return `No row ${rowKey}`;
  }
  const { entry } = view;
  const field = row.field ?? entry.fields[0];
  const value = raw.trim();
  const own = cellState(view, row, language).own;

  if (own && str(own.translation) === value) {
    return 'unchanged';
  }
  const label = `${entry.table}.${field} ${language}`;

  if (value === '') {
    if (!own) {
      return 'unchanged';
    }
    const key = generateCompositeKeyFromRecord(TRANSLATIONS_STORE, own);
    console.log(`[Translations] delete ${label}`);
    await deps.gtfsDatabase.deleteRow(TRANSLATIONS_STORE, key);
    await deps.patchManager.recordDelete(TRANSLATIONS_STORE, key, own);
    return null;
  }

  const typeError = validateFieldValue(
    entry.file,
    field,
    fieldSpec(entry.file, field),
    value
  );
  if (typeError) {
    return typeError;
  }

  if (own) {
    const key = generateCompositeKeyFromRecord(TRANSLATIONS_STORE, own);
    console.log(`[Translations] update ${label}`);
    await patchUpdate(
      deps.gtfsDatabase,
      deps.patchManager,
      TRANSLATIONS_STORE,
      key,
      { translation: own.translation },
      { translation: value }
    );
    return null;
  }

  const record: Record<string, unknown> = {
    table_name: entry.table,
    field_name: field,
    language,
    translation: value,
  };
  if (entry.id !== 'feed_info') {
    if (view.mode === 'value') {
      record.field_value = row.original;
    } else {
      record.record_id = row.record!.id;
      if (row.record!.sub !== '') {
        record.record_sub_id = row.record!.sub;
      }
    }
  }
  const rowError = validateTranslationRow(record);
  if (rowError) {
    return rowError;
  }
  const key = generateCompositeKeyFromRecord(TRANSLATIONS_STORE, record);
  if ((await deps.gtfsDatabase.getRow(TRANSLATIONS_STORE, key)) !== undefined) {
    return 'A translation with these key values already exists';
  }
  console.log(`[Translations] insert ${label}`);
  await deps.gtfsDatabase.insertRows(TRANSLATIONS_STORE, [record]);
  await deps.patchManager.recordInsert(TRANSLATIONS_STORE, key, record);
  return null;
}

/** The own translation of a cell, for the editor's initial value. */
export function cellText(
  view: MatrixView,
  rowKey: string,
  language: string
): { own: string; inherited: string } {
  const row = view.rows.find((candidate) => candidate.key === rowKey);
  if (!row) {
    return { own: '', inherited: '' };
  }
  const cell = cellState(view, row, language);
  return { own: str(cell.own?.translation), inherited: cell.inherited };
}
