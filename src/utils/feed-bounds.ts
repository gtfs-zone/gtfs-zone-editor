/**
 * Feed-wide date bounds, read from `feed_info.feed_start_date` /
 * `feed_end_date`. Scans all rows independently for each field and takes the
 * first non-blank value, since `initializeEmpty` seeds a header row with
 * every field `''` and that blank row is not guaranteed to sort last. Both
 * fields are optional per spec, so either can come back undefined; callers
 * disable whatever button needs the missing one rather than falling back to
 * a computed range.
 */

import type { EditorFeed, FeedRow } from '../feed/editor-feed';
import { deleteOp, updateOp } from '../feed/patch-build';
import { t } from '../i18n/messages';

export interface FeedBounds {
  start?: string;
  end?: string;
}

function firstNonBlank(
  rows: readonly FeedRow[],
  field: string
): string | undefined {
  for (const row of rows) {
    const value = row[field];
    if (value === null || value === undefined) {
      continue;
    }
    const trimmed = String(value).trim();
    if (trimmed !== '') {
      return trimmed;
    }
  }
  return undefined;
}

export function feedBounds(feed: EditorFeed): FeedBounds {
  const rows = feed.table('feed_info');
  const start = firstNonBlank(rows, 'feed_start_date');
  const end = firstNonBlank(rows, 'feed_end_date');
  if (rows.length > 0) {
    if (start === undefined) {
      console.warn(
        `[FeedBounds] feed_info has ${rows.length} row(s) but no usable feed_start_date`
      );
    }
    if (end === undefined) {
      console.warn(
        `[FeedBounds] feed_info has ${rows.length} row(s) but no usable feed_end_date`
      );
    }
  }
  return { start, end };
}

/**
 * `calendar_dates` rows for `service_ids` lying past `value` on `field`'s side:
 * before it for `start_date`, after it for `end_date`. Both exception types are
 * selected. GTFS dates are `YYYYMMDD`, so string comparison is date comparison.
 *
 * `service_ids` undefined means every service.
 */
export async function outOfRangeExceptions(
  feed: EditorFeed,
  field: 'start_date' | 'end_date',
  value: string,
  service_ids?: Set<string>
): Promise<FeedRow[]> {
  const rows = await feed.where('calendar_dates', [
    ...(service_ids ? [{ col: 'service_id', in: [...service_ids] }] : []),
    field === 'start_date'
      ? { col: 'date', lt: value }
      : { col: 'date', gt: value },
  ]);
  return rows.filter((row) => (row.date ?? '').trim() !== '');
}

/** How many rows a trim or extend touched, for the caller's notification. */
export interface TrimOrExtendResult {
  services: number;
  exceptions: number;
}

/**
 * Set each named service's `start_date` (trim) or `end_date` (extend) to
 * `value`, skipping rows already there, and delete the `calendar_dates`
 * exceptions lying past that same edge, as one patch so a single undo
 * reverts the whole action.
 *
 * `service_ids` undefined means every service in `calendar`. Only the edge
 * being acted on is pruned; the other edge's exceptions are left alone.
 */
export async function trimOrExtendServices(
  feed: EditorFeed,
  field: 'start_date' | 'end_date',
  value: string,
  service_ids?: Set<string>
): Promise<TrimOrExtendResult> {
  const updates = feed
    .table('calendar')
    .filter(
      (row) =>
        (!service_ids || service_ids.has(row.service_id)) &&
        (row[field] ?? '') !== value
    )
    .map((row) => updateOp('calendar', row, { [field]: value }));

  const exceptions = await outOfRangeExceptions(
    feed,
    field,
    value,
    service_ids
  );
  const services = updates.length;
  const vars = {
    services: t('count.services', { count: services }),
    exceptions: t('count.exceptions', { count: exceptions.length }),
  };
  const trim = field === 'start_date';
  const applied = await feed.apply(
    [...updates, ...exceptions.map((row) => deleteOp('calendar_dates', row))],
    exceptions.length > 0
      ? t(trim ? 'bounds.trimRemoveLabel' : 'bounds.extendRemoveLabel', vars)
      : t(trim ? 'bounds.trimLabel' : 'bounds.extendLabel', vars)
  );
  if (applied) {
    console.log(
      `[FeedBounds] ${trim ? 'Trim' : 'Extend'} to feed ${trim ? 'start' : 'end'}: ${services} calendar row(s), ${exceptions.length} exception(s) removed`
    );
  }

  return { services, exceptions: exceptions.length };
}
