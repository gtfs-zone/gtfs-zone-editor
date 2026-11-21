/**
 * Whitespace autofix.
 *
 * The validator's UNCLEAN_VALUE warnings all have the same cause (a quoted CSV
 * field that swallowed its line ending) and the same fix, so clearing them one
 * cell at a time is busywork. This applies the given ones as a single patch,
 * which keeps the clean-up to one undo step.
 *
 * Anything it will not fix is counted rather than forced: a required field that
 * would be emptied, a re-keyed row that would collide with an existing one, and
 * a row the issue can no longer be matched to are all reported back to the
 * caller so the notification can say so.
 */

import type { ValidationEntity } from '../modules/gtfs-validator';
import type { EditorFeed, FeedRow } from '../feed/editor-feed';
import { deleteOp, insertOp, updateOp } from '../feed/patch-build';
import type { SingleGTFSPatch } from '../types/patch';
import { GTFS_FIELD_SPECS } from '../types/gtfs';
import {
  generateCompositeKeyFromRecord,
  getGTFSPrimaryKey,
} from './gtfs-primary-keys';
import { t } from '../i18n/messages';

export interface WhitespaceFixResult {
  /** Cells whose value was rewritten. */
  cleaned: number;
  /** Rows those cells belong to. */
  rows: number;
  /** `file.txt field` of every cell skipped for emptying a required field. */
  skippedRequired: string[];
  /** Rows skipped because the trimmed key already belongs to another row. */
  skippedConflict: number;
  /** Issues whose row could not be found, so there was nothing to write. */
  skippedMissing: number;
}

/** The C0 control characters the validator flags on. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f]/g;

/**
 * The value with its control characters removed and its surrounding whitespace
 * trimmed. Same character class the validator flags on, so a cleaned value
 * never trips the warning again.
 */
export function cleanWhitespace(value: string): string {
  return value.replace(CONTROL_CHARS, '').trim();
}

/** The changed fields of one row, plus the record they were read from. */
interface PendingRow {
  key: string;
  record: FeedRow;
  changes: Record<string, string>;
}

export async function applyWhitespaceFix(
  entities: ValidationEntity[],
  feed: EditorFeed
): Promise<WhitespaceFixResult> {
  const result: WhitespaceFixResult = {
    cleaned: 0,
    rows: 0,
    skippedRequired: [],
    skippedConflict: 0,
    skippedMissing: 0,
  };

  const byFile = new Map<string, ValidationEntity[]>();
  for (const entity of entities) {
    byFile.set(entity.file, [...(byFile.get(entity.file) ?? []), entity]);
  }

  const deletes: SingleGTFSPatch[] = [];
  const inserts: SingleGTFSPatch[] = [];
  const updates: (SingleGTFSPatch | null)[] = [];
  const required = new Set<string>();

  for (const [file, fileEntities] of byFile) {
    const table = file.replace(/\.txt$/, '');
    const keys = [
      ...new Set(fileEntities.map((e) => e.id).filter((id) => id !== '')),
    ];
    const found = await feed.byKeys(table, keys);
    const byKey = new Map<string, FeedRow>();
    keys.forEach((key, i) => {
      const row = found[i];
      if (row) {
        byKey.set(key, row);
      }
    });

    const pending = new Map<string, PendingRow>();
    for (const entity of fileEntities) {
      const record = entity.id === '' ? undefined : byKey.get(entity.id);
      if (!record) {
        result.skippedMissing += 1;
        continue;
      }
      const raw = record[entity.field];
      if (typeof raw !== 'string') {
        continue;
      }
      const cleaned = cleanWhitespace(raw);
      if (cleaned === raw) {
        continue;
      }
      if (
        cleaned === '' &&
        GTFS_FIELD_SPECS[file]?.[entity.field]?.presence === 'Required'
      ) {
        required.add(`${file} ${entity.field}`);
        continue;
      }
      const entry = pending.get(entity.id) ?? {
        key: entity.id,
        record,
        changes: {},
      };
      entry.changes[entity.field] = cleaned;
      pending.set(entity.id, entry);
    }

    const keyConfig = getGTFSPrimaryKey(table);
    for (const entry of pending.values()) {
      const after = { ...entry.record, ...entry.changes };
      // A change to any key field re-keys the row, which an update cannot
      // express: the patch would keep the old id and undo would silently drop.
      const reKeys =
        keyConfig?.type === 'all_fields' ||
        (keyConfig?.fields ?? []).some((field) => field in entry.changes);

      if (!reKeys) {
        updates.push(updateOp(table, entry.record, after));
      } else {
        const newKey = generateCompositeKeyFromRecord(table, after);
        const [taken] =
          newKey === entry.key ? [null] : await feed.byKeys(table, [newKey]);
        if (taken) {
          console.warn(
            `[WhitespaceFix] ${table} ${entry.key} would collide with ${newKey}, skipped`
          );
          result.skippedConflict += 1;
          continue;
        }
        deletes.push(deleteOp(table, entry.record));
        inserts.push(insertOp(table, after));
      }
      result.cleaned += Object.keys(entry.changes).length;
      result.rows += 1;
    }
  }

  result.skippedRequired = [...required].sort();

  if (result.rows === 0) {
    console.log('[WhitespaceFix] nothing to write');
    return result;
  }

  console.log(
    `[WhitespaceFix] cleaning ${result.cleaned} values across ${result.rows} rows`
  );

  // Deletes before inserts, so a re-keyed row never collides with itself.
  await feed.apply(
    [...deletes, ...inserts, ...updates],
    t('fix.cleanLabel', { count: result.cleaned })
  );

  return result;
}

/** The one-line notification text for a finished run. */
export function describeWhitespaceFix(result: WhitespaceFixResult): string {
  const parts: string[] = [t('fix.cleaned', { count: result.cleaned })];
  if (result.skippedRequired.length > 0) {
    parts.push(
      t('fix.leftRequired', { fields: result.skippedRequired.join(', ') })
    );
  }
  if (result.skippedConflict > 0) {
    parts.push(t('fix.skippedConflict', { count: result.skippedConflict }));
  }
  if (result.skippedMissing > 0) {
    parts.push(t('fix.skippedMissing', { count: result.skippedMissing }));
  }
  return parts.join('; ');
}
