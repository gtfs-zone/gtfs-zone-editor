/**
 * Patch types for the append-only edit history system.
 */

export type PatchOp = 'insert' | 'update' | 'delete';

/** Direction-specific payload, one of three shapes. */
export type PatchData =
  | { record: Record<string, unknown> } // full row (insert forward / delete inverse)
  | { changes: Record<string, unknown> } // field map (update, just the after/before values)
  | { id: string }; // key-only (insert inverse / delete forward)

/** A single semantic change to one GTFS record. */
export interface SingleGTFSPatch {
  op: PatchOp;
  source: { table: string; id: string; col?: string };
  forward: PatchData;
  inverse: PatchData;
}

/**
 * One entity's ID rename, carried by the batch that performs it.
 *
 * The page names its object by that ID, so replaying the batch in either
 * direction has to take the page with it. Persisted with the patch, so an undo
 * after a reload still follows.
 */
export interface PatchRename {
  table: string;
  keyField: string;
  from: string;
  to: string;
}

/** A batch of single-record updates recorded as one undo/redo step. */
export interface BatchGTFSPatch {
  op: 'batch';
  ops: SingleGTFSPatch[];
  /** Non-table entries the batch replaces, after its row ops. */
  files?: FileChange[];
  label?: string;
  rename?: PatchRename;
}

/** A non-table entry's text before and after; null means absent. */
export interface FileChange {
  name: string;
  before: string | null;
  after: string | null;
}

/** A patch is either a single-record operation or a batch of them. */
export type GTFSPatch = SingleGTFSPatch | BatchGTFSPatch;

/**
 * A non-table archive entry (e.g. `locations.geojson`) replaced as a whole.
 * `null` means the entry is absent on that side.
 */
export interface FilePatch extends FileChange {
  op: 'file';
  label?: string;
}

/** What the feed worker's patch log holds. */
export type FeedPatch = GTFSPatch | FilePatch;

/** One entry of the feed worker's patch log (IndexedDB key: `version`). */
export interface FeedPatchRecord {
  version: number;
  patch: FeedPatch;
  timestamp: number;
}
