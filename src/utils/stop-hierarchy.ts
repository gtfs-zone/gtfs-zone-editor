/**
 * Station hierarchy traversal.
 *
 * A GTFS station (location_type=1) never appears in stop_times: every stop_time
 * references a child platform. Anything asking "what serves this stop?" has to
 * expand the stop into its whole descendant subtree first, or a station looks
 * like it has no service at all.
 */
import type { EditorFeed, FeedRow } from '../feed/editor-feed';

/** station -> platform -> boarding area is the deepest legal nesting. */
const MAX_DEPTH = 3;

/**
 * Collect `stop_id` together with every descendant reachable through
 * `parent_station`, breadth-first.
 *
 * Returns the rows, not just ids, so callers can label results with
 * `getStopDisplay` instead of raw ids. The root stop is always first; it is
 * included even when the stops table has no row for it, in which case only the
 * id is known and the array is empty.
 */
export function collectDescendantStops(
  feed: EditorFeed,
  stop_id: string
): FeedRow[] {
  const root = feed.byKey('stops', stop_id);
  const collected: FeedRow[] = root ? [root] : [];
  const children = new Map<string, FeedRow[]>();
  for (const stop of feed.table('stops')) {
    const parent = stop.parent_station ?? '';
    if (parent !== '') {
      const list = children.get(parent);
      if (list) {
        list.push(stop);
      } else {
        children.set(parent, [stop]);
      }
    }
  }
  const visited = new Set<string>([stop_id]);

  let frontier = [stop_id];
  for (let depth = 0; depth < MAX_DEPTH && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const parentId of frontier) {
      for (const child of children.get(parentId) ?? []) {
        const childId = child.stop_id;
        if (visited.has(childId)) {
          console.warn(
            `[StopHierarchy] Cycle in parent_station: ${childId} is already an ancestor of itself under ${stop_id}, skipping.`
          );
          continue;
        }
        visited.add(childId);
        collected.push(child);
        next.push(childId);
      }
    }
    frontier = next;
  }

  if (frontier.length > 0) {
    console.warn(
      `[StopHierarchy] parent_station nesting deeper than ${MAX_DEPTH} levels under ${stop_id}; ignoring ${frontier.length} deeper stop(s).`
    );
  }

  return collected;
}
