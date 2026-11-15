/**
 * The map's route lines, built in the worker: `routeGeometries` simplified,
 * with lines that simplify to the same points dropped, plus each route's
 * bounds so the main thread never holds the full coordinates.
 */

import type { FeedStore } from 'gtfs-zone-web-common/gtfs/store/feed-store';
import { routeGeometries } from 'gtfs-zone-web-common/gtfs/store/feed-queries';
import { CONFIG } from '../config';

export interface RouteLines {
  routeId: string;
  /** Flat [lon, lat, ...] points of every line, cut at `lineStarts`. */
  coords: Float64Array;
  /** Point index where each line starts. */
  lineStarts: Uint32Array;
  /** [west, south, east, north] over the unsimplified lines. */
  bbox: [number, number, number, number];
}

/**
 * Douglas-Peucker over flat [lon, lat, ...] points of one line (`from` to
 * `to`, point indices, `to` exclusive). Returns the kept point indices in order.
 */
function simplifyLine(
  coords: Float64Array,
  from: number,
  to: number,
  tolerance: number
): number[] {
  const n = to - from;
  if (n < 3) {
    return Array.from({ length: n }, (_, i) => from + i);
  }
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const tol2 = tolerance * tolerance;
  const stack: number[] = [0, n - 1];
  while (stack.length) {
    const b = stack.pop()!;
    const a = stack.pop()!;
    const ax = coords[(from + a) * 2];
    const ay = coords[(from + a) * 2 + 1];
    const dx = coords[(from + b) * 2] - ax;
    const dy = coords[(from + b) * 2 + 1] - ay;
    const len2 = dx * dx + dy * dy;
    let max = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const px = coords[(from + i) * 2] - ax;
      const py = coords[(from + i) * 2 + 1] - ay;
      const t =
        len2 > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / len2)) : 0;
      const ex = px - t * dx;
      const ey = py - t * dy;
      const d2 = ex * ex + ey * ey;
      if (d2 > max) {
        max = d2;
        idx = i;
      }
    }
    if (max > tol2) {
      keep[idx] = 1;
      stack.push(a, idx, idx, b);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (keep[i]) {
      out.push(from + i);
    }
  }
  return out;
}

export function routeLines(store: FeedStore): RouteLines[] {
  const t0 = performance.now();
  const tolerance = CONFIG.ROUTE_LINE_SIMPLIFY_DEG;
  let pointsIn = 0;
  let pointsOut = 0;
  let linesIn = 0;
  let linesOut = 0;
  const out: RouteLines[] = [];
  for (const g of routeGeometries(store)) {
    const total = g.coords.length / 2;
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    for (let p = 0; p < total; p++) {
      const x = g.coords[p * 2];
      const y = g.coords[p * 2 + 1];
      if (x < west) {
        west = x;
      }
      if (x > east) {
        east = x;
      }
      if (y < south) {
        south = y;
      }
      if (y > north) {
        north = y;
      }
    }
    const seen = new Set<string>();
    const kept: number[][] = [];
    for (let i = 0; i < g.lineStarts.length; i++) {
      const from = g.lineStarts[i];
      const to = i + 1 < g.lineStarts.length ? g.lineStarts[i + 1] : total;
      const idx = simplifyLine(g.coords, from, to, tolerance);
      const key = idx
        .map((p) => `${g.coords[p * 2]},${g.coords[p * 2 + 1]}`)
        .join(';');
      if (!seen.has(key)) {
        seen.add(key);
        kept.push(idx);
      }
    }
    linesIn += g.lineStarts.length;
    linesOut += kept.length;
    pointsIn += total;
    let n = 0;
    for (const idx of kept) {
      n += idx.length;
    }
    pointsOut += n;
    const coords = new Float64Array(n * 2);
    const lineStarts = new Uint32Array(kept.length);
    let o = 0;
    kept.forEach((idx, i) => {
      lineStarts[i] = o;
      for (const p of idx) {
        coords[o * 2] = g.coords[p * 2];
        coords[o * 2 + 1] = g.coords[p * 2 + 1];
        o++;
      }
    });
    out.push({
      routeId: g.routeId,
      coords,
      lineStarts,
      bbox: [west, south, east, north],
    });
  }
  console.log(
    `[FeedWorker] routeLines: ${linesIn} -> ${linesOut} lines, ${pointsIn} -> ${pointsOut} points in ${Math.round(performance.now() - t0)}ms`
  );
  return out;
}
