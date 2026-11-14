/**
 * The whole feed as a GTFS zip, built in the feed worker.
 *
 * Every table is written as CSV in chunks of `CONFIG.EXPORT_CHUNK_ROWS` rows
 * into a streaming fflate `Zip`; non-table entries are copied as they are.
 * `FeedExporter.step` runs the writer for up to `CONFIG.EXPORT_STEP_MS` per
 * worker call, so other calls run between steps; a store change between two
 * steps restarts the export.
 *
 * Networks are written in one of two forms: networks.txt + route_networks.txt,
 * or a `routes.network_id` column built from route_networks. A named network
 * forces the files form; otherwise the feed keeps the form it came in.
 */

import { Zip, ZipDeflate } from 'fflate';
import type { FeedStore } from 'gtfs-zone-web-common/gtfs/store/feed-store';
import { CONFIG } from '../config';
import type { NetworksMode } from './feed-log';

/** Progress of a running export, or the finished zip. */
export type ExportStep =
  | {
      done: false;
      /** The file being written. */
      file: string;
      rows: number;
      totalRows: number;
    }
  | { done: true; zip: Blob };

interface Progress {
  file: string;
  rows: number;
}

/** Zip output collected as Blobs, so the browser can page it out of the heap. */
class ZipOut {
  readonly zip: Zip;
  private chunks: Uint8Array<ArrayBuffer>[] = [];
  private chunkBytes = 0;
  private parts: Blob[] = [];
  private finished = false;
  bytes = 0;

  constructor() {
    this.zip = new Zip((err, chunk, final) => {
      if (err) {
        throw err;
      }
      this.chunks.push(chunk as Uint8Array<ArrayBuffer>);
      this.chunkBytes += chunk.length;
      this.bytes += chunk.length;
      if (this.chunkBytes >= CONFIG.EXPORT_BLOB_PART_BYTES || final) {
        this.parts.push(new Blob(this.chunks));
        this.chunks = [];
        this.chunkBytes = 0;
      }
      if (final) {
        this.finished = true;
      }
    });
  }

  blob(): Blob {
    if (!this.finished) {
      throw new Error('[FeedExport] zip read before it was ended');
    }
    return new Blob(this.parts, { type: 'application/zip' });
  }
}

/** One CSV field, quoted when it holds a comma, quote, line break or edge space. */
function csvField(v: string): string {
  return /[",\r\n]|^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function csvLine(values: readonly string[]): string {
  let line = '';
  for (let i = 0; i < values.length; i++) {
    if (i > 0) {
      line += ',';
    }
    line += csvField(values[i]);
  }
  return line + '\n';
}

/** Writes one table's CSV into the zip, encoding every chunk of rows. */
class CsvEntry {
  private file: ZipDeflate;
  private text = '';
  private pending = 0;
  private encoder = new TextEncoder();

  constructor(out: ZipOut, name: string, cols: readonly string[]) {
    this.file = new ZipDeflate(name, { level: 6 });
    out.zip.add(this.file);
    this.text = csvLine(cols);
  }

  /** Add a row; true when a chunk was flushed (a point to yield at). */
  row(values: readonly string[]): boolean {
    this.text += csvLine(values);
    if (++this.pending < CONFIG.EXPORT_CHUNK_ROWS) {
      return false;
    }
    this.file.push(this.encoder.encode(this.text));
    this.text = '';
    this.pending = 0;
    return true;
  }

  end(): void {
    this.file.push(this.encoder.encode(this.text), true);
  }
}

/** The networks form this export writes, and route_id -> network_id for the inline form. */
function networksPlan(
  store: FeedStore,
  mode: NetworksMode
): { files: boolean; networkByRoute: Map<string, string> } {
  let named = false;
  if (store.hasTable('networks')) {
    store.scan('networks', ['network_name'], ([name]) => {
      named ||= name.trim() !== '';
    });
  }
  const files = named || mode === 'files';
  const networkByRoute = new Map<string, string>();
  if (!files && store.hasTable('route_networks')) {
    store.scan(
      'route_networks',
      ['route_id', 'network_id'],
      ([route, network]) => {
        if (route !== '' && network !== '') {
          networkByRoute.set(route, network);
        }
      }
    );
  }
  console.log(
    `[FeedExport] networks as ${files ? 'networks.txt + route_networks.txt' : 'routes.network_id'} (mode ${mode}, ${named ? 'named' : 'unnamed'})`
  );
  return { files, networkByRoute };
}

/** Write the whole feed into `out`, yielding after every chunk of rows. */
function* writeFeed(
  store: FeedStore,
  out: ZipOut,
  mode: NetworksMode
): Generator<Progress, void, void> {
  const counts = store.counts();
  const { files: networkFiles, networkByRoute } = networksPlan(store, mode);

  for (const table of store.tableNames()) {
    if ((counts[table] ?? 0) === 0) {
      continue;
    }
    if (!networkFiles && (table === 'networks' || table === 'route_networks')) {
      continue;
    }
    const file = `${table}.txt`;
    let rows = 0;
    let cols = store.columns(table);

    if (table === 'stop_times' || table === 'shapes') {
      const entry = new CsvEntry(out, file, cols);
      const values = cols.map(() => '');
      const groups =
        table === 'stop_times' ? store.tripsWithStopTimes() : store.shapeIds();
      for (const id of groups) {
        const group =
          table === 'stop_times'
            ? store.stopTimesForTrip(id)
            : store.shapeRows(id);
        for (const row of group) {
          for (let c = 0; c < cols.length; c++) {
            values[c] = row[cols[c]] ?? '';
          }
          rows++;
          if (entry.row(values)) {
            yield { file, rows };
          }
        }
      }
      entry.end();
      continue;
    }

    // routes.network_id comes from route_networks (inline form) or is left out.
    const routes = table === 'routes';
    const inline = routes && !networkFiles && networkByRoute.size > 0;
    if (routes) {
      cols = cols.filter((c) => c !== 'network_id');
    }
    const routeIdCol = cols.indexOf('route_id');
    const header = inline ? [...cols, 'network_id'] : cols;
    const entry = new CsvEntry(out, file, header);
    const line = header.map(() => '');
    // Row ids run from 0 with gaps where rows were deleted; `scan` cannot
    // yield, so rows are read one id at a time until every live row is out.
    for (let id = 0; rows < counts[table]; id++) {
      const row = store.row(table, id);
      if (!row) {
        continue;
      }
      for (let c = 0; c < cols.length; c++) {
        line[c] = row[cols[c]] ?? '';
      }
      if (inline) {
        line[cols.length] = networkByRoute.get(line[routeIdCol]) ?? '';
      }
      rows++;
      if (entry.row(line)) {
        yield { file, rows };
      }
    }
    entry.end();
  }

  for (const name of store.fileNames()) {
    const bytes = store.file(name);
    if (!bytes) {
      continue;
    }
    const entry = new ZipDeflate(name, { level: 6 });
    out.zip.add(entry);
    entry.push(bytes, true);
    yield { file: name, rows: 0 };
  }
  out.zip.end();
}

export class FeedExporter {
  private job: {
    store: FeedStore;
    revision: number;
    out: ZipOut;
    gen: Generator<Progress, void, void>;
    totalRows: number;
    t0: number;
  } | null = null;

  /** Drop a running export. */
  cancel(): void {
    if (this.job) {
      console.log('[FeedExport] cancelled');
    }
    this.job = null;
  }

  step(store: FeedStore, revision: number, mode: NetworksMode): ExportStep {
    if (
      !this.job ||
      this.job.store !== store ||
      this.job.revision !== revision
    ) {
      if (this.job) {
        console.log('[FeedExport] feed changed mid-export, restarting');
      }
      const out = new ZipOut();
      this.job = {
        store,
        revision,
        out,
        gen: writeFeed(store, out, mode),
        totalRows: Object.values(store.counts()).reduce((a, b) => a + b, 0),
        t0: performance.now(),
      };
    }
    const job = this.job;
    const until = performance.now() + CONFIG.EXPORT_STEP_MS;
    try {
      for (;;) {
        const r = job.gen.next();
        if (r.done) {
          this.job = null;
          const zip = job.out.blob();
          console.log(
            `[FeedExport] ${job.totalRows} rows, ${zip.size} bytes in ${Math.round(performance.now() - job.t0)}ms`
          );
          return { done: true, zip };
        }
        if (performance.now() >= until) {
          return {
            done: false,
            file: r.value.file,
            rows: r.value.rows,
            totalRows: job.totalRows,
          };
        }
      }
    } catch (err) {
      this.job = null;
      throw err;
    }
  }
}
