/**
 * The feed_info active range, held for date pickers to shade.
 *
 * Read from the mirrored feed_info when a picker opens. Null unless
 * feed_info carries both dates.
 */

import type { EditorFeed } from '../feed/editor-feed';
import { feedBounds } from './feed-bounds';
import { t } from '../i18n/messages';

export interface FeedActiveRange {
  /** `YYYY-MM-DD`, the inline editor's date format. */
  start: string;
  end: string;
  /** Legend text for the band. */
  label: string;
}

let feed: EditorFeed | null = null;

/** Read feed_info from `source` from now on. */
export function bindFeedActiveRange(source: EditorFeed): void {
  feed = source;
}

/** `YYYYMMDD` to `YYYY-MM-DD`, or null when it is not a GTFS date. */
function gtfsToIso(value: string): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

export function getFeedActiveRange(): FeedActiveRange | null {
  if (!feed?.isOpen) {
    return null;
  }
  const bounds = feedBounds(feed);
  const start = bounds.start ? gtfsToIso(bounds.start) : null;
  const end = bounds.end ? gtfsToIso(bounds.end) : null;
  if ((bounds.start && !start) || (bounds.end && !end)) {
    console.warn(
      `[FeedActiveRange] feed_info dates are not YYYYMMDD: ${bounds.start} to ${bounds.end}`
    );
  }
  return start && end ? { start, end, label: t('bounds.feedActive') } : null;
}
