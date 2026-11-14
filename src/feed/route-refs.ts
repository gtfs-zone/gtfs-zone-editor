/**
 * Which stops, zones and location groups each route's trips reference, and
 * the reverse (routes at a stop), held on the main thread for synchronous
 * readers such as the map's spotlight.
 *
 * Built in the worker once per feed and again after any edit to trips,
 * stop_times or routes. Until a build lands, readers see the previous build
 * (or nothing on a fresh feed); `onChange` fires when one lands.
 */

import type { EditorFeed } from './editor-feed';
import type { RouteRefs } from './feed-worker-api';

const EMPTY: RouteRefs = { stops: [], zones: [], groups: [] };
const SOURCE_TABLES = ['trips', 'stop_times', 'routes'];

export class RouteRefsIndex {
  private byRoute: Record<string, RouteRefs> = {};
  private byStop = new Map<string, string[]>();
  private seq = 0;
  private listeners = new Set<() => void>();
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly feed: EditorFeed) {
    feed.onFeedReplaced(() => this.rebuild());
    feed.onEdit((e) => {
      if (e.tables.some((t) => SOURCE_TABLES.includes(t))) {
        this.rebuild();
      }
    });
  }

  /** What a route's trips reference; empty for an unknown route. */
  route(route_id: string): RouteRefs {
    return this.byRoute[route_id] ?? EMPTY;
  }

  /** Routes with a trip stopping at `stop_id`. */
  routesAtStop(stop_id: string): string[] {
    return this.byStop.get(stop_id) ?? [];
  }

  /** Resolves once the latest requested build has landed. */
  whenReady(): Promise<void> {
    return this.pending;
  }

  onChange(listener: () => void): void {
    this.listeners.add(listener);
  }

  private rebuild(): void {
    const seq = ++this.seq;
    if (!this.feed.isOpen) {
      this.install({});
      return;
    }
    const t0 = performance.now();
    this.pending = this.feed
      .routeRefs()
      .then((refs) => {
        if (seq !== this.seq) {
          return;
        }
        this.install(refs);
        console.log(
          `[RouteRefs] ${Object.keys(refs).length} routes indexed in ${Math.round(performance.now() - t0)}ms`
        );
      })
      .catch((e: unknown) => {
        console.error('[RouteRefs] build failed:', e);
      });
  }

  private install(refs: Record<string, RouteRefs>): void {
    this.byRoute = refs;
    const byStop = new Map<string, string[]>();
    for (const [route, r] of Object.entries(refs)) {
      for (const stop of r.stops) {
        const list = byStop.get(stop);
        if (list) {
          list.push(route);
        } else {
          byStop.set(stop, [route]);
        }
      }
    }
    this.byStop = byStop;
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        console.error('[RouteRefs] listener threw:', err);
      }
    }
  }
}
