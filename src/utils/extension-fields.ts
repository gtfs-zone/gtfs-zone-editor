/**
 * Non-spec ("extension") columns on a GTFS table.
 *
 * Producers routinely add their own columns to a GTFS file, and those columns
 * already survive the round trip: the import worker keeps every parsed column
 * and `generateCSVFromRows` writes the union of keys across all rows. Only the
 * UI could not see them, because it derives its columns from web-common's `gtfs/spec/`.
 *
 * So an extension column is *derived from the data*, not configured: a column
 * exists because rows have that key. The one case data-derivation cannot
 * express is a column the user just created and has not filled in yet, so that
 * single case is kept in the feed state (`EditorFeed.extensionColumns`).
 *
 * Fields an overlay adds to a base file (Google's `trip_direction_name`, ...)
 * follow the same rule to decide whether they show, but render with their
 * typed overlay spec rather than the plain text one an extension column gets.
 *
 * Nothing here writes to the Zod schemas: those are generated from
 * web-common's `gtfs/spec/`, which its `pnpm check-spec` keeps on the reference.
 */

import { GTFS_FIELD_SPECS } from '../types/gtfs';
import type { GTFSFieldSpec } from 'gtfs-zone-web-common/gtfs/spec/types';
import { t } from '../i18n/messages';

export const EXTENSION_FIELD_DESCRIPTION = t('field.extensionDescription');

export interface ExtensionColumnStore {
  readonly extensionColumns: Readonly<Record<string, readonly string[]>>;
  setExtensionColumns(columns: Record<string, string[]>): Promise<void>;
}

let store: ExtensionColumnStore | null = null;

/** User-added column names per table, read from the open feed. */
function addedColumns(): Readonly<Record<string, readonly string[]>> {
  try {
    return store?.extensionColumns ?? {};
  } catch {
    // No feed open.
    return {};
  }
}

/** Read and write user-added columns through `feed` from now on. */
export function bindExtensionColumns(feed: ExtensionColumnStore): void {
  store = feed;
}

// ─── Deriving the columns ─────────────────────────────────────────────────────

const keyMemo = new WeakMap<object, Set<string>>();

/**
 * Every key the rows carry, in order of first appearance.
 *
 * Memoised on the rows array so the several callers per render share one pass.
 * Feed rows are frozen and a change gives the table a new array, so a result
 * keyed on the array's identity cannot go stale.
 */
function rowKeys(rows: readonly Record<string, unknown>[]): Set<string> {
  const cached = keyMemo.get(rows);
  if (cached) {
    return cached;
  }
  const keys = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      keys.add(key);
    }
  }
  keyMemo.set(rows, keys);
  return keys;
}

/**
 * The non-spec columns of a table, in order of first appearance.
 *
 * Returns nothing for a file with no field specs (`locations.geojson`), which
 * is not a CSV table and whose feature properties are not columns.
 */
export function extensionFields(
  tableName: string,
  rows: readonly Record<string, unknown>[]
): string[] {
  const specs = GTFS_FIELD_SPECS[tableName];
  if (!specs) {
    return [];
  }
  const fields = new Set<string>();
  for (const key of rowKeys(rows)) {
    if (!(key in specs)) {
      fields.add(key);
    }
  }
  // A column the user just created has no values in any row yet, so it only
  // exists here.
  for (const key of addedColumns()[tableName] ?? []) {
    if (!(key in specs)) {
      fields.add(key);
    }
  }
  return [...fields];
}

/**
 * Whether a spec field of a table shows for these rows.
 *
 * A base field always does. A field an overlay adds to a base file (Google's
 * `vehicle_type`, ...) shows only when the rows carry the column or the user
 * added it, so a feed that never used one is not cluttered with it.
 */
export function specFieldShown(
  tableName: string,
  field: string,
  rows: readonly Record<string, unknown>[]
): boolean {
  const spec = GTFS_FIELD_SPECS[tableName]?.[field];
  if (!spec?.origin) {
    return true;
  }
  return (
    rowKeys(rows).has(field) ||
    (addedColumns()[tableName] ?? []).includes(field)
  );
}

/** The table's spec fields that show for these rows, in spec order. */
export function shownSpecFields(
  tableName: string,
  rows: readonly Record<string, unknown>[]
): string[] {
  return Object.keys(GTFS_FIELD_SPECS[tableName] ?? {}).filter((field) =>
    specFieldShown(tableName, field, rows)
  );
}

/** The overlay fields of a table hidden for these rows, in spec order. */
export function hiddenOverlayFields(
  tableName: string,
  rows: readonly Record<string, unknown>[]
): string[] {
  return Object.keys(GTFS_FIELD_SPECS[tableName] ?? {}).filter(
    (field) => !specFieldShown(tableName, field, rows)
  );
}

const syntheticSpecs = new Map<string, GTFSFieldSpec>();

/**
 * The stand-in spec for an extension field.
 *
 * Everything that renders or edits a cell asks the spec how: which editor, how
 * to coerce, how to display. An extension field has no spec, so it gets a
 * plain optional text one. Cached per name so repeated lookups are identity
 * stable.
 */
export function extensionFieldSpec(field: string): GTFSFieldSpec {
  const existing = syntheticSpecs.get(field);
  if (existing) {
    return existing;
  }
  const spec: GTFSFieldSpec = {
    name: field,
    type: 'Text',
    presence: 'Optional',
    description: EXTENSION_FIELD_DESCRIPTION,
  };
  syntheticSpecs.set(field, spec);
  return spec;
}

// ─── Adding a column ──────────────────────────────────────────────────────────

/** CSV header names we are willing to create: the shape GTFS itself uses. */
const VALID_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Validate a proposed column name against the table's spec and existing
 * columns. Returns an error message, or null when the name may be used.
 *
 * The duplicate checks are case-insensitive: a column differing from a spec
 * field only in case is a typo every time, and accepting it would produce two
 * columns that read identically.
 */
export function validateExtensionColumnName(
  tableName: string,
  rows: readonly Record<string, unknown>[],
  name: string
): string | null {
  const trimmed = name.trim();
  if (trimmed === '') {
    return t('field.extEnterName');
  }
  if (!VALID_NAME.test(trimmed)) {
    return t('field.extInvalidName');
  }
  const specs = GTFS_FIELD_SPECS[tableName];
  if (!specs) {
    return t('field.extNoFields', { table: tableName });
  }
  // A hidden overlay field is added by its exact name, and then shows with its
  // typed spec.
  if (hiddenOverlayFields(tableName, rows).includes(trimmed)) {
    return null;
  }
  const lower = trimmed.toLowerCase();
  if (Object.keys(specs).some((f) => f.toLowerCase() === lower)) {
    return t('field.extIsSpec', { name: trimmed, table: tableName });
  }
  if (extensionFields(tableName, rows).some((f) => f.toLowerCase() === lower)) {
    return t('field.extExists', { table: tableName, name: trimmed });
  }
  return null;
}

/**
 * Remember a user-added column for a table.
 *
 * No row is touched: seeding the key on every row would rewrite the whole
 * table to add an empty column, which is a large patch carrying no data. The
 * consequence is that a column left empty everywhere does not appear in the
 * export, since the export unions row keys. The Add field dialog says so.
 */
export async function addExtensionColumn(
  tableName: string,
  name: string
): Promise<void> {
  const field = name.trim();
  if (!store) {
    throw new Error('[ExtensionFields] no feed bound');
  }
  const added = addedColumns();
  const next: Record<string, string[]> = {};
  for (const [table, cols] of Object.entries(added)) {
    next[table] = [...cols];
  }
  next[tableName] = [...(next[tableName] ?? []), field];
  await store.setExtensionColumns(next);
  console.log(`[ExtensionFields] added column ${tableName}.${field}`);
}
