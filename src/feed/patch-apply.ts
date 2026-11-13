/**
 * Apply a feed patch to a FeedStore, forward or inverse.
 *
 * Patches name rows by primary key string (`source.id`), never by store row
 * id, since row ids change on every fold. A key is resolved against the
 * table's index on its first key field, with a full scan as the fallback
 * when a value holds the key separator.
 *
 * stop_times and shapes are edited per trip / per shape: their ops change a
 * working copy of each touched trip or shape, written back once at the end.
 *
 * All or nothing: when an op fails, the ops already applied are undone and
 * the error is rethrown.
 */

import type {
  FeedStore,
  Row,
} from 'gtfs-zone-web-common/gtfs/store/feed-store';
import type { FeedPatch, PatchData, SingleGTFSPatch } from '../types/patch';
import {
  generateCompositeKeyFromRecord,
  getGTFSPrimaryKey,
} from '../utils/gtfs-primary-keys';

export type Direction = 'forward' | 'inverse';

/** Tables stored per group: the group column is their first key field. */
const GROUPED: Record<string, string> = {
  stop_times: 'trip_id',
  shapes: 'shape_id',
};

/** One store-level step, after the direction is resolved. */
type Step =
  | { kind: 'insert'; table: string; record: Row }
  | { kind: 'delete'; table: string; key: string }
  | {
      kind: 'update';
      table: string;
      key: string;
      /** The values to write. */
      changes: Row;
      /** Applied to a current row, gives the row `key` names. */
      toKey: Row | null;
      /** Values the row must hold now (the forward change, for an inverse). */
      expect: Row | null;
      /**
       * The first key field's current value when the forward change set it
       * (so the key string no longer names it).
       */
      firstNow: string | null;
    }
  | { kind: 'file'; name: string; text: string | null };

function toRow(values: Record<string, unknown>): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(values)) {
    out[k] = v === undefined || v === null ? '' : String(v);
  }
  return out;
}

function recordOf(data: PatchData, what: string): Row {
  if (!('record' in data)) {
    throw new Error(`[FeedPatch] ${what}: patch has no record`);
  }
  return toRow(data.record);
}

function changesOf(data: PatchData, what: string): Row {
  if (!('changes' in data)) {
    throw new Error(`[FeedPatch] ${what}: patch has no changes`);
  }
  return toRow(data.changes);
}

function stepOf(op: SingleGTFSPatch, dir: Direction): Step {
  const { table, id } = op.source;
  const what = `${op.op} ${table} ${id}`;
  if (op.op === 'insert') {
    return dir === 'forward'
      ? { kind: 'insert', table, record: recordOf(op.forward, what) }
      : { kind: 'delete', table, key: id };
  }
  if (op.op === 'delete') {
    return dir === 'forward'
      ? { kind: 'delete', table, key: id }
      : { kind: 'insert', table, record: recordOf(op.inverse, what) };
  }
  const forward = changesOf(op.forward, what);
  const inverse = changesOf(op.inverse, what);
  if (dir === 'forward') {
    return {
      kind: 'update',
      table,
      key: id,
      changes: forward,
      toKey: null,
      expect: null,
      firstNow: null,
    };
  }
  // `source.id` keys the row as it was before the forward change, so an
  // inverse finds its row by undoing the change first.
  const first = getGTFSPrimaryKey(table)?.fields[0];
  return {
    kind: 'update',
    table,
    key: id,
    changes: inverse,
    toKey: inverse,
    expect: forward,
    firstNow: first !== undefined && first in forward ? forward[first] : null,
  };
}

/** The steps of a patch in the order they apply. */
function stepsOf(patch: FeedPatch, dir: Direction): Step[] {
  if (patch.op === 'file') {
    return [
      {
        kind: 'file',
        name: patch.name,
        text: dir === 'forward' ? patch.after : patch.before,
      },
    ];
  }
  if (patch.op === 'batch') {
    const ops = dir === 'forward' ? patch.ops : [...patch.ops].reverse();
    return ops.map((op) => stepOf(op, dir));
  }
  return [stepOf(patch, dir)];
}

/**
 * The key of a row. Tables without a stated key, and the all-fields ones,
 * key on every non-empty field, so a column added after the patch was
 * recorded does not change the key.
 */
function keyOf(table: string, row: Row): string {
  const pk = getGTFSPrimaryKey(table);
  if (pk && pk.type !== 'all_fields') {
    return generateCompositeKeyFromRecord(table, row);
  }
  return Object.keys(row)
    .filter((k) => row[k] !== '')
    .sort()
    .map((k) => `${k}=${row[k]}`)
    .join('&');
}

/** `key` with the all-fields form's empty `field=` parts dropped. */
function normalizeKey(table: string, key: string): string {
  const pk = getGTFSPrimaryKey(table);
  if (pk && pk.type !== 'all_fields') {
    return key;
  }
  return key
    .split('&')
    .filter((part) => !/^[a-z0-9_]+=$/.test(part))
    .join('&');
}

/**
 * The value of the table's first key field that a key names, as far as the
 * key string tells. Null when it cannot (no stated key, or all fields).
 */
function firstValue(
  table: string,
  key: string,
  firstNow: string | null
): string | null {
  if (firstNow !== null) {
    return firstNow;
  }
  const pk = getGTFSPrimaryKey(table);
  if (!pk || pk.fields.length === 0) {
    return null;
  }
  if (pk.type === 'natural') {
    return key;
  }
  if (table in GROUPED) {
    // The sequence is numeric, so the last separator ends the group id.
    const at = key.lastIndexOf(':');
    return at < 0 ? null : key.slice(0, at);
  }
  return key.split(':')[0];
}

/** How a delete or update names its row. */
interface Lookup {
  key: string;
  toKey: Row | null;
  expect: Row | null;
  firstNow: string | null;
}

function lookupOf(step: Extract<Step, { kind: 'delete' | 'update' }>): Lookup {
  return step.kind === 'update'
    ? step
    : { key: step.key, toKey: null, expect: null, firstNow: null };
}

function matches(table: string, row: Row, look: Lookup): boolean {
  if (look.expect) {
    for (const [k, v] of Object.entries(look.expect)) {
      if ((row[k] ?? '') !== v) {
        return false;
      }
    }
  }
  const keyed = look.toKey ? { ...row, ...look.toKey } : row;
  return keyOf(table, keyed) === normalizeKey(table, look.key);
}

/** Applies steps to one store and remembers how to take them back. */
class Applier {
  /** Store-level undo, newest last. */
  private undo: (() => void)[] = [];
  /** Working copies of touched trips / shapes, by table then group id. */
  private groups = new Map<string, Map<string, Row[]>>();

  constructor(private readonly store: FeedStore) {}

  run(step: Step): void {
    if (step.kind === 'file') {
      this.file(step.name, step.text);
    } else if (step.table in GROUPED) {
      this.grouped(step);
    } else {
      this.ordinary(step);
    }
  }

  // ---------- ordinary tables ----------

  private ordinary(step: Exclude<Step, { kind: 'file' }>): void {
    const s = this.store;
    if (step.kind === 'insert') {
      if (!s.hasTable(step.table)) {
        s.ensureTable(step.table, Object.keys(step.record));
      }
      const id = s.insertRow(step.table, step.record);
      this.undo.push(() => s.deleteRow(step.table, id));
      return;
    }
    const { id, row } = this.locate(step.table, lookupOf(step));
    if (step.kind === 'delete') {
      s.deleteRow(step.table, id);
      this.undo.push(() => {
        s.insertRow(step.table, row);
      });
      return;
    }
    s.updateRow(step.table, id, { ...row, ...step.changes });
    this.undo.push(() => s.updateRow(step.table, id, row));
  }

  private locate(table: string, look: Lookup): { id: number; row: Row } {
    const s = this.store;
    const rawKey = look.key;
    if (!s.hasTable(table)) {
      throw new Error(
        `[FeedPatch] ${table} has no row ${rawKey}: no such table`
      );
    }
    const pk = getGTFSPrimaryKey(table);
    const field = pk?.fields[0];
    const first = firstValue(table, normalizeKey(table, rawKey), look.firstNow);
    let found =
      field && first !== null
        ? s
            .find(table, field, first)
            .filter(({ row }) => matches(table, row, look))
        : [];
    if (found.length === 0) {
      found = [];
      const cols = s.columns(table);
      s.scan(table, cols, (values, id) => {
        const row: Row = {};
        cols.forEach((c, i) => (row[c] = values[i]));
        if (matches(table, row, look)) {
          found.push({ id, row });
        }
      });
    }
    if (found.length === 0) {
      throw new Error(`[FeedPatch] ${table} has no row ${rawKey}`);
    }
    if (found.length > 1) {
      console.warn(
        `[FeedPatch] ${table}: ${found.length} rows share key ${rawKey}; using the first`
      );
    }
    return found[0];
  }

  // ---------- stop_times and shapes ----------

  private rowsOf(table: string, group: string): Row[] {
    let byGroup = this.groups.get(table);
    if (!byGroup) {
      byGroup = new Map();
      this.groups.set(table, byGroup);
    }
    let rows = byGroup.get(group);
    if (!rows) {
      rows =
        table === 'stop_times'
          ? this.store.stopTimesForTrip(group)
          : this.store.shapeRows(group);
      byGroup.set(group, rows);
    }
    return rows;
  }

  private grouped(step: Exclude<Step, { kind: 'file' }>): void {
    const col = GROUPED[step.table];
    if (step.kind === 'insert') {
      const group = step.record[col] ?? '';
      if (!group) {
        throw new Error(`[FeedPatch] ${step.table} insert without ${col}`);
      }
      this.rowsOf(step.table, group).push({ ...step.record });
      return;
    }
    const look = lookupOf(step);
    const group = firstValue(step.table, step.key, look.firstNow);
    if (group === null) {
      throw new Error(
        `[FeedPatch] ${step.table} ${step.key}: the key names no ${col}`
      );
    }
    const rows = this.rowsOf(step.table, group);
    const at = rows.findIndex((r) => matches(step.table, r, look));
    if (at < 0) {
      throw new Error(`[FeedPatch] ${step.table} has no row ${step.key}`);
    }
    if (step.kind === 'delete') {
      rows.splice(at, 1);
      return;
    }
    const next = { ...rows[at], ...step.changes };
    const target = next[col] ?? '';
    if (target !== group) {
      rows.splice(at, 1);
      this.rowsOf(step.table, target).push(next);
    } else {
      rows[at] = next;
    }
  }

  /** Write the touched trips and shapes back. */
  flush(): void {
    const s = this.store;
    for (const [table, byGroup] of this.groups) {
      for (const [group, rows] of byGroup) {
        const before =
          table === 'stop_times'
            ? s.stopTimesForTrip(group)
            : s.shapeRows(group);
        if (table === 'stop_times') {
          s.setTripStopTimes(group, rows);
          this.undo.push(() => s.setTripStopTimes(group, before));
        } else {
          s.setShape(group, rows);
          this.undo.push(() => s.setShape(group, before));
        }
      }
    }
    this.groups.clear();
  }

  // ---------- files ----------

  private file(name: string, text: string | null): void {
    const s = this.store;
    const before = s.file(name);
    s.setFile(name, text === null ? null : new TextEncoder().encode(text));
    this.undo.push(() => s.setFile(name, before));
  }

  rollback(): void {
    this.groups.clear();
    while (this.undo.length) {
      this.undo.pop()!();
    }
  }
}

/** Apply one patch, all or nothing. */
export function applyPatch(
  store: FeedStore,
  patch: FeedPatch,
  dir: Direction
): void {
  applyPatches(store, [patch], dir);
}

/**
 * Apply patches in the order given, each in `dir`, all or nothing. stop_times
 * and shapes are written once at the end.
 */
export function applyPatches(
  store: FeedStore,
  patches: FeedPatch[],
  dir: Direction
): void {
  const a = new Applier(store);
  try {
    for (const patch of patches) {
      for (const step of stepsOf(patch, dir)) {
        a.run(step);
      }
    }
    a.flush();
  } catch (err) {
    console.error(`[FeedPatch] ${dir} apply failed; rolling back`, err);
    a.rollback();
    throw err;
  }
}
