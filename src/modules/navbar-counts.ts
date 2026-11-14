import { getZoneCollection } from './zone-store';
import type { EditorFeed } from '../feed/editor-feed';

/**
 * Count bubbles on the navbar buttons (shapes, services, levels, fare products,
 * transfers, translations, attributions, on-demand objects, changes).
 *
 * Mirrored tables are counted on the main thread; shapes, transfers,
 * translations and calendar_dates come from the worker, so a refresh is
 * async and a newer one supersedes an older one still in flight.
 */
export class NavbarCounts {
  private seq = 0;

  constructor(private readonly feed: EditorFeed) {}

  /** Wire refreshes to every event that can change one of the counts. */
  initialize(): void {
    this.feed.onEdit(() => this.refresh());
    this.feed.onFeedReplaced(() => this.refresh());
    this.refresh();
  }

  refresh(): void {
    const seq = ++this.seq;
    this.count()
      .then((counts) => {
        if (seq !== this.seq) {
          return;
        }
        for (const [id, count] of Object.entries(counts)) {
          setBadge(id, count);
        }
      })
      .catch((e: unknown) =>
        console.error('[NavbarCounts] refresh failed:', e)
      );
  }

  private async count(): Promise<Record<string, number>> {
    const feed = this.feed;
    if (!feed.isOpen) {
      return {
        'shapes-count-badge': 0,
        'calendar-count-badge': 0,
        'levels-count-badge': 0,
        'fares-count-badge': 0,
        'transfers-count-badge': 0,
        'translations-count-badge': 0,
        'attributions-count-badge': 0,
        'on-demand-count-badge': 0,
        'history-count-badge': 0,
      };
    }
    const [counts, shapeIds, exceptionServices] = await Promise.all([
      feed.read('counts'),
      feed.read('shapeIds'),
      feed.distinct('calendar_dates', 'service_id'),
    ]);
    // Distinct service_ids across calendar.txt and calendar_dates.txt.
    const services = new Set(exceptionServices);
    for (const row of feed.table('calendar')) {
      if (row.service_id) {
        services.add(row.service_id);
      }
    }
    return {
      'shapes-count-badge': shapeIds.length,
      'calendar-count-badge': services.size,
      'levels-count-badge': feed.table('levels').length,
      'fares-count-badge': feed.table('fare_products').length,
      'transfers-count-badge': counts.transfers ?? 0,
      'translations-count-badge': counts.translations ?? 0,
      'attributions-count-badge': feed.table('attributions').length,
      // Booking rules, location groups and zones together.
      'on-demand-count-badge':
        feed.table('booking_rules').length +
        feed.table('location_groups').length +
        getZoneCollection(feed).features.length,
      'history-count-badge': feed.version,
    };
  }
}

// A zero count renders nothing rather than a "0" bubble on an empty feed.
function setBadge(id: string, count: number): void {
  const el = document.getElementById(id);
  if (!el) {
    return;
  }
  el.textContent = String(count);
  el.classList.toggle('hidden', count === 0);
}
