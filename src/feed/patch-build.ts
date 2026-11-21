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
  FileChange,
  GTFSPatch,
  PatchRename,
  SingleGTFSPatch,
} from '../types/patch';
import { generateCompositeKeyFromRecord } from '../utils/gtfs-primary-keys';

type Values = Readonly<Record<string, unknown>>;

/** Values as stored: strings, with null and undefined as ''. */
function stored(values: Values): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    out[k] = v === undefined || v === null ? '' : String(v);
  }
  return out;
}

export function insertOp(table: string, record: Values): SingleGTFSPatch {
  const row = stored(record);
  const id = generateCompositeKeyFromRecord(table, row);
  return {
    op: 'insert',
    source: { table, id },
    forward: { record: row },
    inverse: { id },
  };
}

export function deleteOp(table: string, record: Values): SingleGTFSPatch {
  const row = stored(record);
  const id = generateCompositeKeyFromRecord(table, row);
  return {
    op: 'delete',
    source: { table, id },
    forward: { id },
    inverse: { record: row },
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
  const was = stored(before);
  const now = stored(after);
  const forward: Record<string, string> = {};
  const inverse: Record<string, string> = {};
  for (const key of Object.keys(now)) {
    const old = was[key] ?? '';
    if (old !== now[key]) {
      forward[key] = now[key];
      inverse[key] = old;
    }
  }
  if (Object.keys(forward).length === 0) {
    return null;
  }
  return {
    op: 'update',
    source: { table, id: generateCompositeKeyFromRecord(table, was) },
    forward: { changes: forward },
    inverse: { changes: inverse },
  };
}

/**
 * One undo step from several ops, in the order given (put deletes before
 * inserts on the same key), plus whole non-table entries replaced after
 * them. A single op without a rename or files is sent on its own; nothing
 * to do gives null.
 */
export function batch(
  ops: (SingleGTFSPatch | null)[],
  label?: string,
  rename?: PatchRename,
  files: FileChange[] = []
): GTFSPatch | null {
  const kept = ops.filter((op): op is SingleGTFSPatch => op !== null);
  const changed = files.filter((f) => f.before !== f.after);
  if (kept.length === 0 && changed.length === 0) {
    return null;
  }
  if (kept.length === 1 && !rename && changed.length === 0) {
    return kept[0];
  }
  const patch: BatchGTFSPatch = { op: 'batch', ops: kept };
  if (changed.length > 0) {
    patch.files = changed.map((f) => ({ ...f }));
  }
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
  const files = patch.op === 'batch' ? (patch.files ?? []) : [];
  return {
    tables: [...new Set(ops.map((op) => op.source.table))],
    files: [...new Set(files.map((f) => f.name))],
  };
}
