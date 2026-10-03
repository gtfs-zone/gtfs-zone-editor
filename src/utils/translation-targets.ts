/**
 * What a `translations.txt` row can point at, derived from the spec: the
 * tables `table_name` allows, the fields each of them can translate, and the
 * fields `record_id` / `record_sub_id` name.
 */

import { extensionFields } from './extension-fields';
import { getGTFSPrimaryKey } from './gtfs-primary-keys';
import {
  GTFS_FIELD_SPECS,
  GTFS_PRIMARY_KEYS as SPEC_PRIMARY_KEYS,
  GTFS_TABLES,
} from '../types/gtfs';

/** The field types the reference allows a translation to target. */
const TRANSLATABLE_TYPES = new Set(['Text', 'URL', 'Email', 'Phone number']);

/** The store names `table_name` allows, in spec order. */
export function translatableTables(): string[] {
  return (
    GTFS_FIELD_SPECS[GTFS_TABLES.TRANSLATIONS].table_name.enumValues?.map(
      (value) => String(value.value)
    ) ?? []
  );
}

/** Spec fields of a translatable type, then the table's extension fields. */
export function translatableFields(
  file: string,
  rows: Record<string, unknown>[]
): string[] {
  const specs = GTFS_FIELD_SPECS[file] ?? {};
  const fields = Object.entries(specs)
    .filter(([, spec]) => TRANSLATABLE_TYPES.has(spec.type))
    .map(([name]) => name);
  return [...fields, ...extensionFields(file, rows)];
}

/**
 * The fields `record_id` and `record_sub_id` name for a table: the first and
 * second fields of its primary key. A table keyed on all fields
 * (attributions) falls back to the spec's single primary key field.
 */
export function translationRecordFields(
  table: string
): { id: string; sub?: string } | null {
  const key = getGTFSPrimaryKey(table);
  if (key && key.fields.length > 0) {
    return { id: key.fields[0], sub: key.fields[1] };
  }
  const specKey = SPEC_PRIMARY_KEYS[`${table}.txt`];
  return specKey ? { id: specKey } : null;
}
