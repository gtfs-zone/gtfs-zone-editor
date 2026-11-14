import type { EditorFeed, FeedRow } from '../feed/editor-feed';
import type {
  RouteSource,
  RouteSourceTrip,
  RouteSourceStopTime,
} from 'gtfs-zone-web-common/gtfs/route-source';
import type { StopTimeRef } from 'gtfs-zone-web-common/gtfs/types';
import { stopTimeRef } from '../utils/stop-time-ref';
import type { StopTimes } from '../types/gtfs-entities';
import { getZoneFeatures, zoneName } from './zone-store';

interface StopIndexEntry {
  parent?: string;
  name?: string;
}

/**
 * RouteSource over one route of the editor feed, read once from the worker.
 *
 * `load` fetches the route's trips and one stop_times list per stop pattern
 * (trips sharing a pattern share every reference), so the sync RouteSource
 * calls need no worker round trip. Names come from the mirrors. The data is a
 * snapshot: build a fresh instance after an edit.
 */
export class GTFSRouteSource implements RouteSource {
  private stopIndex: Map<string, StopIndexEntry> | null = null;
  private locationGroupIndex: Map<string, string> | null = null;
  private zoneIndex: Map<string, string> | null = null;

  private constructor(
    private readonly feed: EditorFeed,
    private readonly route_id: string,
    private readonly trips: readonly FeedRow[],
    private readonly stopTimes: Map<string, RouteSourceStopTime[]>
  ) {}

  static async load(
    feed: EditorFeed,
    route_id: string
  ): Promise<GTFSRouteSource> {
    const { trips, stopLists, tripList } = await feed.read(
      'routeTrips',
      route_id
    );
    // One trip per stop pattern stands for all trips with that pattern.
    const firstTrip: string[] = [];
    tripList.forEach((list, i) => {
      if (list >= 0 && firstTrip[list] === undefined) {
        firstTrip[list] = trips[i].trip_id ?? '';
      }
    });
    const patterns = await Promise.all(
      stopLists.map(async (_stops, list) =>
        (await feed.read('stopTimesForTrip', firstTrip[list]))
          .map((st) => ({
            ref: stopTimeRef(st as StopTimes),
            stop_sequence: Number(st.stop_sequence),
          }))
          .sort((a, b) => a.stop_sequence - b.stop_sequence)
      )
    );
    const stopTimes = new Map<string, RouteSourceStopTime[]>();
    tripList.forEach((list, i) => {
      stopTimes.set(trips[i].trip_id ?? '', list >= 0 ? patterns[list] : []);
    });
    return new GTFSRouteSource(feed, route_id, trips, stopTimes);
  }

  tripsForRoute(route_id: string, service_id?: string): RouteSourceTrip[] {
    if (route_id !== this.route_id) {
      throw new Error(
        `[GTFSRouteSource] loaded for route ${this.route_id}, asked for ${route_id}`
      );
    }
    const scoped = service_id
      ? this.trips.filter((t) => (t.service_id ?? '') === service_id)
      : this.trips;
    return scoped.map((t) => ({
      trip_id: t.trip_id ?? '',
      direction_id:
        t.direction_id !== undefined && t.direction_id !== ''
          ? t.direction_id
          : undefined,
      headsign: t.trip_headsign ? t.trip_headsign : undefined,
    }));
  }

  stopTimesForTrip(trip_id: string): RouteSourceStopTime[] {
    return this.stopTimes.get(trip_id) ?? [];
  }

  /** Walk parent_station to the topmost ancestor, guarding against cycles. */
  stationRoot(stop_id: string): string {
    const index = this.getStopIndex();
    const seen = new Set<string>([stop_id]);
    let current = stop_id;
    for (;;) {
      const parent = index.get(current)?.parent;
      if (!parent || !index.has(parent)) {
        return current;
      }
      if (seen.has(parent)) {
        console.warn(
          `[GTFSRouteSource] cyclic parent_station chain at stop ${stop_id}, treating ${current} as its own root`
        );
        return current;
      }
      seen.add(parent);
      current = parent;
    }
  }

  stopName(stop_id: string): string | undefined {
    return this.getStopIndex().get(stop_id)?.name;
  }

  locationGroupName(location_group_id: string): string | undefined {
    return this.getLocationGroupIndex().get(location_group_id);
  }

  zoneName(location_id: string): string | undefined {
    return this.getZoneIndex().get(location_id);
  }

  refName(ref: StopTimeRef): string | undefined {
    if (ref.kind === 'stop') {
      return this.stopName(ref.id);
    }
    if (ref.kind === 'location_group') {
      return this.locationGroupName(ref.id);
    }
    return this.zoneName(ref.id);
  }

  private getStopIndex(): Map<string, StopIndexEntry> {
    if (this.stopIndex) {
      return this.stopIndex;
    }
    const index = new Map<string, StopIndexEntry>();
    for (const stop of this.feed.table('stops')) {
      index.set(stop.stop_id ?? '', {
        parent: stop.parent_station || undefined,
        name: stop.stop_name || undefined,
      });
    }
    this.stopIndex = index;
    return index;
  }

  private getLocationGroupIndex(): Map<string, string> {
    if (this.locationGroupIndex) {
      return this.locationGroupIndex;
    }
    const index = new Map<string, string>();
    for (const group of this.feed.table('location_groups')) {
      const id = group.location_group_id ?? '';
      if (id && group.location_group_name) {
        index.set(id, group.location_group_name);
      }
    }
    this.locationGroupIndex = index;
    return index;
  }

  private getZoneIndex(): Map<string, string> {
    if (this.zoneIndex) {
      return this.zoneIndex;
    }
    const index = new Map<string, string>();
    for (const feature of getZoneFeatures(this.feed)) {
      const name = zoneName(feature);
      if (feature.id !== undefined && name) {
        index.set(String(feature.id), name);
      }
    }
    this.zoneIndex = index;
    return index;
  }
}
