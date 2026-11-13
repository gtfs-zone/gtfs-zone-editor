/**
 * Building feed patches from rows. Callers send the result through
 * `EditorFeed.edit`, which applies it in the worker; nothing writes rows
 * before the patch exists.
 *
 * Keys come from the row itself (`before` for an update), so a patch always
 * names the row as the store holds it now.
 */

import type {
  BatchGTFSPatch,
  FeedPatch,
  GTFSPatch,
  PatchRename,
  SingleGTFSPatch,
} from '../types/patch';
import { generateCompositeKeyFromRecord } from '../utils/gtfs-primary-keys';

type Values = Record<string, string>;

export function insertOp(table: string, record: Values): SingleGTFSPatch {
  const id = generateCompositeKeyFromRecord(table, record);
  return {
    op: 'insert',
    source: { table, id },
    forward: { record: { ...record } },
    inverse: { id },
  };
}

export function deleteOp(table: string, record: Values): SingleGTFSPatch {
  const id = generateCompositeKeyFromRecord(table, record);
  return {
    op: 'delete',
    source: { table, id },
    forward: { id },
    inverse: { record: { ...record } },
  };
}

/**
 * The fields of `after` that differ from `before`, as an update. Null when
 * nothing changes.
 */
export function updateOp(
  table: string,
  before: Values,
  after: Values
): SingleGTFSPatch | null {
  const forward: Values = {};
  const inverse: Values = {};
  for (const key of Object.keys(after)) {
    const was = before[key] ?? '';
    if (was !== after[key]) {
      forward[key] = after[key];
      inverse[key] = was;
    }
  }
  if (Object.keys(forward).length === 0) {
    return null;
  }
  return {
    op: 'update',
    source: { table, id: generateCompositeKeyFromRecord(table, before) },
    forward: { changes: forward },
    inverse: { changes: inverse },
  };
}

/**
 * One undo step from several ops, in the order given (put deletes before
 * inserts on the same key). A single op without a rename is sent on its own;
 * no ops gives null.
 */
export function batch(
  ops: (SingleGTFSPatch | null)[],
  label?: string,
  rename?: PatchRename
): GTFSPatch | null {
  const kept = ops.filter((op): op is SingleGTFSPatch => op !== null);
  if (kept.length === 0) {
    return null;
  }
  if (kept.length === 1 && !rename) {
    return kept[0];
  }
  const patch: BatchGTFSPatch = { op: 'batch', ops: kept };
  if (label) {
    patch.label = label;
  }
  if (rename) {
    patch.rename = { ...rename };
  }
  return patch;
}

/** The tables and non-table entries a patch writes. */
export function patchTargets(patch: FeedPatch): {
  tables: string[];
  files: string[];
} {
  if (patch.op === 'file') {
    return { tables: [], files: [patch.name] };
  }
  const ops = patch.op === 'batch' ? patch.ops : [patch];
  return { tables: [...new Set(ops.map((op) => op.source.table))], files: [] };
}
