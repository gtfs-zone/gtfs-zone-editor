/**
 * Rename a GTFS entity's ID, cascading to every field that references it.
 *
 * The cascade is derived from the spec: `GTFS_FOREIGN_KEYS` says which fields
 * point at the renamed table's primary key, and `GTFS_PRIMARY_KEYS` says
 * whether a referencing row's own key contains that field. A row whose key
 * contains it has to be deleted and re-inserted, not updated: an update leaves
 * the patch's `source.id` pointing at the old key and undo silently drops.
 */

import type { EditorFeed, FeedRow } from '../feed/editor-feed';
import { deleteOp, insertOp, updateOp } from '../feed/patch-build';
import { GTFS_FOREIGN_KEYS } from '../types/gtfs';
import {
  getGTFSPrimaryKey,
  getNaturalKeyField,
} from 'gtfs-zone-web-common/gtfs/spec/primary-keys';
import { generateCompositeKeyFromRecord } from './gtfs-primary-keys';
import {
  translatableTables,
  translationRecordFields,
} from './translation-targets';
import { CONFIG } from '../config';
import { t } from '../i18n/messages';

/** One referencing field's contribution to a rename, for display. */
export interface RenameCascade {
  table: string;
  field: string;
  rows: number;
  rekeys: boolean;
}

/** One row to rewrite. `rekeys` means delete + insert rather than update. */
export interface RenameEdit {
  table: string;
  rekeys: boolean;
  key: string;
  before: FeedRow;
  after: Record<string, string>;
  fields: string[];
}

export interface RenamePlan {
  table: string;
  keyField: string;
  oldId: string;
  newId: string;
  /** The row being renamed, as it stands before the rename. */
  row: FeedRow;
  /** One entry per referencing (table, field) pair that has matching rows. */
  cascades: RenameCascade[];
  edits: RenameEdit[];
  /** Rows written, including the renamed row itself. */
  total: number;
  /** Set above CONFIG.RENAME_CASCADE_WARN: worth warning about, not refusing. */
  heavy: boolean;
}

function tableNameForFile(fileName: string): string {
  return fileName.replace(/\.txt$/, '');
}

/**
 * Whether a row in `table` re-keys when `field` changes.
 *
 * `all_fields` tables key on every column, so any change re-keys. `none` is a
 * single-row table (feed_info, locations), whose key is a constant.
 */
function fieldIsPartOfKey(table: string, field: string): boolean {
  const config = getGTFSPrimaryKey(table);
  if (!config) {
    return false;
  }
  if (config.type === 'all_fields') {
    return true;
  }
  return config.fields.includes(field);
}

/** Whether `table.field` is the renamed key field, or a foreign key to it. */
function namesRenamedKey(
  table: string,
  field: string,
  renamedTable: string,
  keyField: string
): boolean {
  if (table === renamedTable && field === keyField) {
    return true;
  }
  return GTFS_FOREIGN_KEYS.some(
    (ref) =>
      ref.file === `${table}.txt` &&
      ref.field === field &&
      ref.targets.some(
        (t) => t.file === `${renamedTable}.txt` && t.field === keyField
      )
  );
}

/** The empty and whitespace checks every new ID must pass. */
export function validateIdText(id: string): string | null {
  if (id === '') {
    return t('renameRule.empty');
  }
  if (id !== id.trim()) {
    return t('renameRule.whitespace');
  }
  return null;
}

/**
 * Check an ID for a new or renamed row of `table`. Returns an error message, or
 * null if it is usable.
 */
export async function validateNewId(
  feed: EditorFeed,
  table: string,
  id: string
): Promise<string | null> {
  const textError = validateIdText(id);
  if (textError) {
    return textError;
  }
  const [clash] = await feed.byKeys(table, [id]);
  if (clash) {
    return t('renameRule.taken', { table, id });
  }
  return null;
}

/**
 * Check a proposed new ID. Returns an error message, or null if it is usable.
 * Exported so the modal can validate as the user types.
 */
export async function validateRenameTarget(
  feed: EditorFeed,
  table: string,
  oldId: string,
  newId: string
): Promise<string | null> {
  if (newId !== '' && newId === oldId) {
    return t('renameRule.unchanged');
  }
  return validateNewId(feed, table, newId);
}

/**
 * Work out everything a rename would touch. Reads only: nothing is written
 * until `applyRename` is called with the returned plan.
 */
export async function renamePlan(
  feed: EditorFeed,
  table: string,
  oldId: string,
  newId: string
): Promise<RenamePlan> {
  const keyField = getNaturalKeyField(table);
  if (!keyField) {
    throw new Error(`[renameEntity] ${table} has no natural key to rename`);
  }

  const invalid = await validateRenameTarget(feed, table, oldId, newId);
  if (invalid) {
    throw new Error(`[renameEntity] ${invalid}`);
  }

  const [row] = await feed.byKeys(table, [oldId]);
  if (!row) {
    throw new Error(`[renameEntity] no row "${oldId}" in ${table}`);
  }

  const cascades: RenameCascade[] = [];
  // Keyed on table + current row key so a row matched by two fields (a
  // transfer from a stop to itself) is rewritten once, not twice.
  const edits = new Map<string, RenameEdit>();

  for (const ref of GTFS_FOREIGN_KEYS) {
    const pointsHere = ref.targets.some(
      (t) => t.file === `${table}.txt` && t.field === keyField
    );
    if (!pointsHere) {
      continue;
    }
    // locations.geojson is one row holding a FeatureCollection, not a table of
    // referencing rows. Renaming a location_id is out of scope for this pass.
    if (ref.file === 'locations.geojson') {
      continue;
    }
    // routes.network_id is never written: networks are canonical as
    // networks + route_networks, and only export reads it back.
    if (ref.file === 'routes.txt' && ref.field === 'network_id') {
      continue;
    }

    // A blank attributions.agency_id applies to the whole dataset, not to the
    // feed's single agency, so setting that agency's ID leaves it alone.
    if (table === 'agency' && oldId === '' && ref.file === 'attributions.txt') {
      continue;
    }

    const refTable = tableNameForFile(ref.file);
    // Strict equality on the stored value. Renaming a named agency leaves the
    // implicitly-resolved blank agency_id rows of a single-agency feed alone;
    // setting the ID of a blank agency rewrites them, since they are its rows.
    const matches = await feed.where(refTable, [{ col: ref.field, eq: oldId }]);
    const rekeys = fieldIsPartOfKey(refTable, ref.field);

    let counted = 0;
    for (const match of matches) {
      const key = generateCompositeKeyFromRecord(refTable, match);
      if (refTable === table && key === oldId) {
        console.warn(
          `[renameEntity] ${table} row "${oldId}" references itself through ${ref.field}; skipping the self-reference`
        );
        continue;
      }
      counted++;
      const editKey = `${refTable}\u0000${key}`;
      const existing = edits.get(editKey);
      if (existing) {
        existing.after = { ...existing.after, [ref.field]: newId };
        existing.fields.push(ref.field);
        continue;
      }
      edits.set(editKey, {
        table: refTable,
        rekeys,
        key,
        before: match,
        after: { ...match, [ref.field]: newId },
        fields: [ref.field],
      });
    }

    if (counted > 0) {
      cascades.push({
        table: refTable,
        field: ref.field,
        rows: counted,
        rekeys,
      });
    }
  }

  // translations.txt names a record by the value of its table's first (and
  // second) key field. Every translations column is part of its key, so these
  // re-key. A blank oldId is skipped: a blank record_id means by value.
  if (oldId !== '') {
    const counts = new Map<string, number>();
    for (const target of translatableTables()) {
      const ids = translationRecordFields(target);
      const columns: [string, string | undefined][] = [
        ['record_id', ids?.id],
        ['record_sub_id', ids?.sub],
      ];
      for (const [column, field] of columns) {
        if (!field || !namesRenamedKey(target, field, table, keyField)) {
          continue;
        }
        const matches = await feed.where('translations', [
          { col: 'table_name', eq: target },
          { col: column, eq: oldId },
        ]);
        for (const match of matches) {
          const key = generateCompositeKeyFromRecord('translations', match);
          const editKey = `translations\u0000${key}`;
          const existing = edits.get(editKey);
          if (existing) {
            existing.after = { ...existing.after, [column]: newId };
            existing.fields.push(column);
          } else {
            edits.set(editKey, {
              table: 'translations',
              rekeys: true,
              key,
              before: match,
              after: { ...match, [column]: newId },
              fields: [column],
            });
          }
          counts.set(column, (counts.get(column) ?? 0) + 1);
        }
      }
    }
    for (const [column, rows] of counts) {
      cascades.push({
        table: 'translations',
        field: column,
        rows,
        rekeys: true,
      });
    }

    // A leftover translation already naming newId would collide on insert
    // halfway through applyRename.
    for (const edit of edits.values()) {
      if (edit.table !== 'translations') {
        continue;
      }
      const newKey = generateCompositeKeyFromRecord('translations', edit.after);
      const [taken] = await feed.byKeys('translations', [newKey]);
      if (taken) {
        throw new Error(
          `[renameEntity] translations already has a ${edit.after.table_name}.${edit.after.field_name} (${edit.after.language}) row for "${newId}"; delete it first`
        );
      }
    }
  }

  const editList = [...edits.values()];
  const total = editList.length + 1;

  return {
    table,
    keyField,
    oldId,
    newId,
    row,
    cascades,
    edits: editList,
    total,
    heavy: total > CONFIG.RENAME_CASCADE_WARN,
  };
}

/**
 * Write a plan out as one patch: the renamed row plus every referencing row,
 * so one undo takes the whole rename back.
 *
 * Deletes go first, so neither forward replay nor the reversed inverse replay
 * ever holds two rows on one key.
 */
export async function applyRename(
  feed: EditorFeed,
  plan: RenamePlan
): Promise<void> {
  const { table, keyField, oldId, newId, row, edits } = plan;

  const invalid = await validateRenameTarget(feed, table, oldId, newId);
  if (invalid) {
    throw new Error(`[renameEntity] ${invalid}`);
  }

  const rekeyEdits = edits.filter((e) => e.rekeys);
  const updateEdits = edits.filter((e) => !e.rekeys);

  // The renamed row always re-keys: its key is the renamed field.
  const ops = [
    deleteOp(table, row),
    ...rekeyEdits.map((edit) => deleteOp(edit.table, edit.before)),
    insertOp(table, { ...row, [keyField]: newId }),
    ...rekeyEdits.map((edit) => insertOp(edit.table, edit.after)),
    ...updateEdits.map((edit) => updateOp(edit.table, edit.before, edit.after)),
  ];

  await feed.apply(
    ops,
    `Rename ${table}.${keyField} "${oldId}" to "${newId}"`,
    { table, keyField, from: oldId, to: newId }
  );

  console.log(
    `[renameEntity] Renamed ${table}.${keyField} "${oldId}" to "${newId}": ${plan.total} row${plan.total !== 1 ? 's' : ''}, ${ops.length} patch ops`
  );
}
