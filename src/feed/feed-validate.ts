/**
 * Feed validation over the store (runs in the feed worker).
 *
 * The sweep is a generator that yields every `CONFIG.VALIDATE_CHUNK_ROWS`
 * rows. `FeedValidator.step` runs it for up to `CONFIG.VALIDATE_STEP_MS` per
 * worker call, so other calls run between steps; a store change between two
 * steps restarts the sweep.
 *
 * stop_times rules other than the times run once per stop list (the trips of
 * a pattern share every column but trip_id and the times) and are reported
 * for each trip using it. The times of unedited trips and the points of
 * unedited shapes are checked once per base and cached.
 */

import type {
  FeedStore,
  Row,
} from 'gtfs-zone-web-common/gtfs/store/feed-store';
import type { Patterns } from 'gtfs-zone-web-common/gtfs/store/patterns';
import type { ShapeTable } from 'gtfs-zone-web-common/gtfs/store/shapes';
import { CONFIG } from '../config';
import {
  GTFS_FIELD_SPECS,
  GTFS_FOREIGN_KEYS,
  GTFS_TABLES,
} from '../types/gtfs';
import { getEnumOptions } from '../types/gtfs-enums';
import { ALL_GTFS_FILES } from '../modules/gtfs-file-registry';
import { GTFSFieldType, mapGTFSTypeString } from '../types/gtfs-field-types';
import type { Pathways, Stops } from '../types/gtfs-entities';
import { stopLocationType } from '../utils/area-hierarchy';
import {
  isValidCurrencyCode,
  isValidLanguageCode,
  isValidTimezone,
} from '../utils/constrained-values';
import {
  validateFareLegJoinRuleRow,
  validateFareTransferRuleRow,
  validateTimeframeRow,
  validateTransferRow,
} from '../utils/fares-rules';
import { validateValue } from '../utils/field-formatters';
import {
  validateBookingRuleRow,
  validateFlexStopTimeRow,
  validateLocationGroupId,
} from '../utils/flex-rules';
import {
  frequencyEndIsAmbiguous,
  frequencyPeriodKey,
  frequencyRowProblem,
} from '../utils/frequency-rules';
import { generateCompositeKeyFromRecord } from '../utils/gtfs-primary-keys';
import { buildStopCoordResolver, hasValidCoords } from '../utils/stop-coords';
import { TimeFormatter } from '../utils/time-formatter';
import {
  translatableTables,
  translationRecordFields,
} from '../utils/translation-targets';
import { t } from '../i18n/messages';

/** The offending row, so a message can be traced back to an editable object. */
export interface ValidationEntity {
  /** File the offending row lives in, e.g. "trips.txt". */
  file: string;
  /** Primary key of that row, as produced by generateCompositeKeyFromRecord. */
  id: string;
  /** Field carrying the problem. */
  field: string;
  /** Value of that field. */
  value: string;
}

export interface ValidationMessage {
  level: 'error' | 'warning' | 'info';
  message: string;
  code?: string;
  file?: string;
  line?: number;
  field?: string;
  entity?: ValidationEntity;
}

export interface ValidationResults {
  errors: ValidationMessage[];
  warnings: ValidationMessage[];
  info: ValidationMessage[];
  summary: {
    isValid: boolean;
    errorCount: number;
    warningCount: number;
    infoCount: number;
  };
}

/** One `validateStep` reply: the pass still running, or the results. */
export type ValidateStep =
  { done: false; pass: string } | { done: true; results: ValidationResults };

type Pass = Generator<void, void, void>;

/**
 * Declarations the generic sweep must not treat as hard references. They stay
 * on the spec because the pickers use them to offer options.
 *
 * - calendar_dates.service_id: the reference type is "Foreign ID referencing
 *   calendar.service_id or ID", so a service defined only in calendar_dates.txt
 *   is valid, not dangling.
 * - stop_times.location_id: locations.geojson is not a row table; the
 *   stop_times pass checks it against the zone ids.
 */
const SKIPPED_FOREIGN_KEYS = new Set([
  'calendar_dates.txt:service_id',
  'stop_times.txt:location_id',
]);

/** Leading/trailing whitespace, or a control character anywhere in the value. */
// eslint-disable-next-line no-control-regex
const UNCLEAN_VALUE = /^\s|\s$|[\u0000-\u001f]/;

const STOP_TIMES = GTFS_TABLES.STOP_TIMES;
const SHAPES = GTFS_TABLES.SHAPES;

const isValidUrl = (v: string) => validateValue(v, GTFSFieldType.URL).valid;
const isValidTime = (v: string) => validateValue(v, GTFSFieldType.Time).valid;
const isValidDate = (v: string) => validateValue(v, GTFSFieldType.Date).valid;
const isValidLatitude = (v: string) =>
  validateValue(parseFloat(v), GTFSFieldType.Latitude).valid;
const isValidLongitude = (v: string) =>
  validateValue(parseFloat(v), GTFSFieldType.Longitude).valid;

/** Store table name of a file name. */
const tableOf = (file: string): string => file.replace(/\.txt$/, '');

/** Primary key of a row, or '' when it has none. */
function rowId(table: string, row: Record<string, unknown>): string {
  try {
    return generateCompositeKeyFromRecord(table, row);
  } catch {
    return '';
  }
}

/** A message before it is tied to a row of stop_times or shapes. */
interface RowIssue {
  level: 'error' | 'warning';
  code: string;
  text: string;
  entity?: { field: string; value: string };
}

/** What one sweep reads and writes. */
class Sweep {
  readonly errors: ValidationMessage[] = [];
  readonly warnings: ValidationMessage[] = [];
  readonly info: ValidationMessage[] = [];
  readonly counts: Record<string, number>;
  /** Non-empty locations.geojson feature ids. */
  readonly zoneIds = new Set<string>();
  readonly zones: GeoJSON.Feature[];
  private valueCache = new Map<string, Set<string>>();

  constructor(
    readonly s: FeedStore,
    readonly extensionColumns: Record<string, string[]>
  ) {
    this.counts = s.counts();
    const bytes = s.file(GTFS_TABLES.LOCATIONS_GEOJSON);
    let collection: Partial<GeoJSON.FeatureCollection> | null = null;
    if (bytes) {
      try {
        collection = JSON.parse(new TextDecoder().decode(bytes));
      } catch (err) {
        this.error(
          `locations.geojson is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
          'INVALID_GEOMETRY',
          GTFS_TABLES.LOCATIONS_GEOJSON
        );
      }
    }
    this.zones = collection?.features ?? [];
    for (const feature of this.zones) {
      const id = String(feature.id ?? '').trim();
      if (id !== '') {
        this.zoneIds.add(id);
      }
    }
  }

  has(table: string): boolean {
    return (this.counts[table] ?? 0) > 0;
  }

  push(
    level: 'error' | 'warning',
    message: string,
    code: string,
    file: string | null = null,
    line: number | null = null,
    entity: ValidationEntity | null = null
  ): void {
    (level === 'error' ? this.errors : this.warnings).push({
      level,
      message,
      code,
      file: file || undefined,
      line: line || undefined,
      field: entity?.field,
      entity: entity || undefined,
    });
  }

  error(
    message: string,
    code: string,
    file: string | null = null,
    line: number | null = null,
    entity: ValidationEntity | null = null
  ): void {
    this.push('error', message, code, file, line, entity);
  }

  warning(
    message: string,
    code: string,
    file: string | null = null,
    line: number | null = null,
    entity: ValidationEntity | null = null
  ): void {
    this.push('warning', message, code, file, line, entity);
  }

  addInfo(message: string, code: string): void {
    this.info.push({ level: 'info', message, code });
  }

  /** Distinct non-empty values of one column of any table, memoized. */
  values(table: string, field: string): Set<string> {
    const key = `${table}:${field}`;
    const cached = this.valueCache.get(key);
    if (cached) {
      return cached;
    }
    const out = new Set<string>();
    const s = this.s;
    if (!s.hasTable(table)) {
      // No rows: nothing to match.
    } else if (table === 'shapes') {
      if (field !== 'shape_id') {
        throw new Error(`[FeedValidator] no values of shapes.${field}`);
      }
      for (const id of s.shapeIds()) {
        out.add(id);
      }
    } else if (table === 'stop_times') {
      if (field === 'trip_id') {
        for (const id of s.tripsWithStopTimes()) {
          out.add(id);
        }
      } else {
        s.forEachStopList((_stops, tripIds) => {
          for (const row of s.stopTimesForTrip(tripIds[0])) {
            const v = row[field] ?? '';
            if (v !== '') {
              out.add(v);
            }
          }
        });
      }
    } else {
      s.scan(table, [field], ([v]) => {
        if (v !== '') {
          out.add(v);
        }
      });
    }
    this.valueCache.set(key, out);
    return out;
  }
}

/** Every row of an ordinary table, with its position, chunked. */
function* eachRow(
  s: FeedStore,
  table: string,
  fn: (row: Row, index: number) => void
): Pass {
  if (!s.hasTable(table)) {
    return;
  }
  const ids: number[] = [];
  s.scan(table, [], (_values, id) => {
    ids.push(id);
  });
  for (let i = 0; i < ids.length; i++) {
    if (i > 0 && i % CONFIG.VALIDATE_CHUNK_ROWS === 0) {
      yield;
    }
    fn(s.row(table, ids[i])!, i);
  }
}

/** Every row of a small ordinary table. */
function allRows(s: FeedStore, table: string): Row[] {
  return s.hasTable(table) ? s.rows(table).map((r) => r.row) : [];
}

/** UNCLEAN_VALUE issues of one row's fields, skipping `skip`. */
function whitespaceIssues(
  row: Row,
  out: RowIssue[],
  skip?: ReadonlySet<string>
): void {
  for (const field in row) {
    const value = row[field];
    if (skip?.has(field) || !UNCLEAN_VALUE.test(value)) {
      continue;
    }
    out.push({
      level: 'warning',
      code: 'UNCLEAN_VALUE',
      text: `${field} ${JSON.stringify(value)} has surrounding whitespace or a control character`,
      entity: { field, value },
    });
  }
}

/** The value set and message wording for each foreign key one file declares. */
interface ForeignKeyCheck {
  field: string;
  known: Set<string>;
  targetNames: string;
}

function foreignKeyChecks(c: Sweep, file: string): ForeignKeyCheck[] {
  const checks: ForeignKeyCheck[] = [];
  for (const ref of GTFS_FOREIGN_KEYS) {
    if (
      ref.file !== file ||
      SKIPPED_FOREIGN_KEYS.has(`${ref.file}:${ref.field}`)
    ) {
      continue;
    }
    const known = new Set<string>();
    for (const target of ref.targets) {
      for (const v of c.values(tableOf(target.file), target.field)) {
        known.add(v);
      }
    }
    const targetNames = ref.targets
      .map((target) => `${tableOf(target.file)}.${target.field}`)
      .join(' or ');
    checks.push({ field: ref.field, known, targetNames });
  }
  return checks;
}

function foreignKeyIssues(
  checks: ForeignKeyCheck[],
  row: Row,
  out: RowIssue[]
): void {
  for (const check of checks) {
    const value = row[check.field] ?? '';
    if (value === '' || check.known.has(value)) {
      continue;
    }
    out.push({
      level: 'error',
      code: 'INVALID_REFERENCE',
      text: `${check.field} '${value}' not found in ${check.targetNames}`,
      entity: { field: check.field, value },
    });
  }
}

// ─── Passes ──────────────────────────────────────────────────────────────────

function requiredFiles(c: Sweep): void {
  // stops.txt is Conditionally Required: optional when the feed defines
  // demand-responsive zones in locations.geojson, required otherwise.
  const required = [
    'agency',
    'routes',
    'trips',
    ...(c.zoneIds.size > 0 ? [] : ['stops']),
    'stop_times',
  ];
  for (const table of required) {
    if (!c.has(table)) {
      c.error(
        `Required file ${table}.txt is empty`,
        'MISSING_REQUIRED_FILE',
        `${table}.txt`
      );
    }
  }
  if (!c.has('calendar') && !c.has('calendar_dates')) {
    c.error(
      'At least one calendar file is required: calendar.txt or calendar_dates.txt',
      'MISSING_CALENDAR_FILE'
    );
  }
}

/** Entries kept as files that the spec does not define (e.g. `trips2.txt`). */
function unknownFiles(c: Sweep): void {
  for (const name of c.s.fileNames()) {
    if (!ALL_GTFS_FILES.includes(name)) {
      c.warning(
        `${name} is not a GTFS file; it is kept unchanged for export`,
        'UNKNOWN_FILE',
        name
      );
    }
  }
}

function agencies(c: Sweep): void {
  const file = GTFS_TABLES.AGENCY;
  const rows = allRows(c.s, 'agency');
  if (rows.length === 0) {
    c.error('agency.txt is empty', 'EMPTY_FILE', file);
    return;
  }
  const ids = new Set<string>();
  rows.forEach((agency, index) => {
    const rowNum = index + 1;
    if ((agency.agency_name ?? '').trim() === '') {
      c.error(
        `Row ${rowNum}: agency_name is required`,
        'MISSING_REQUIRED_FIELD',
        file,
        rowNum
      );
    }
    if ((agency.agency_url ?? '').trim() === '') {
      c.error(
        `Row ${rowNum}: agency_url is required`,
        'MISSING_REQUIRED_FIELD',
        file,
        rowNum
      );
    } else if (!isValidUrl(agency.agency_url ?? '')) {
      c.error(
        `Row ${rowNum}: agency_url is not a valid URL`,
        'INVALID_URL',
        file,
        rowNum
      );
    }
    if ((agency.agency_timezone ?? '').trim() === '') {
      c.error(
        `Row ${rowNum}: agency_timezone is required`,
        'MISSING_REQUIRED_FIELD',
        file,
        rowNum
      );
    }
    const id = agency.agency_id ?? '';
    if (id !== '') {
      if (ids.has(id)) {
        c.error(
          `Row ${rowNum}: Duplicate agency_id '${id}'`,
          'DUPLICATE_ID',
          file,
          rowNum
        );
      }
      ids.add(id);
    } else if (rows.length > 1) {
      c.error(
        `Row ${rowNum}: agency_id is required when multiple agencies exist`,
        'MISSING_REQUIRED_FIELD',
        file,
        rowNum
      );
    }
  });
  c.addInfo(`Found ${rows.length} agencies`, 'AGENCY_COUNT');
}

function routes(c: Sweep): void {
  const file = GTFS_TABLES.ROUTES;
  const rows = allRows(c.s, 'routes');
  if (rows.length === 0) {
    c.error('routes.txt is empty', 'EMPTY_FILE', file);
    return;
  }
  const validRouteTypes = new Set(
    (getEnumOptions('route_type') ?? []).map((opt) => String(opt.value))
  );
  const ids = new Set<string>();
  rows.forEach((route, index) => {
    const rowNum = index + 1;
    const id = route.route_id ?? '';
    if (id.trim() === '') {
      c.error(
        `Row ${rowNum}: route_id is required`,
        'MISSING_REQUIRED_FIELD',
        file,
        rowNum
      );
    } else {
      if (ids.has(id)) {
        c.error(
          `Row ${rowNum}: Duplicate route_id '${id}'`,
          'DUPLICATE_ID',
          file,
          rowNum
        );
      }
      ids.add(id);
    }
    if (!route.route_short_name && !route.route_long_name) {
      c.error(
        `Row ${rowNum}: Either route_short_name or route_long_name is required`,
        'MISSING_REQUIRED_FIELD',
        file,
        rowNum
      );
    }
    if (!route.route_type) {
      c.error(
        `Row ${rowNum}: route_type is required`,
        'MISSING_REQUIRED_FIELD',
        file,
        rowNum
      );
    } else if (!validRouteTypes.has(route.route_type)) {
      c.warning(
        `Row ${rowNum}: Unknown route_type '${route.route_type}'`,
        'UNKNOWN_ROUTE_TYPE',
        file,
        rowNum
      );
    }
  });
  c.addInfo(`Found ${rows.length} routes`, 'ROUTE_COUNT');
}

function* stops(c: Sweep): Pass {
  const file = GTFS_TABLES.STOPS;
  const rows = allRows(c.s, 'stops');
  if (rows.length === 0) {
    // A zone-only demand-responsive feed legitimately has no stops.
    if (c.zoneIds.size === 0) {
      c.error('stops.txt is empty', 'EMPTY_FILE', file);
    }
    return;
  }
  // Lat/lon are only required for stops/platforms (0), stations (1) and
  // entrances/exits (2). Generic nodes (3) and boarding areas (4) may omit
  // them and inherit position from their parent_station. Missing coords are
  // accepted for any location_type as long as a coord-having ancestor exists;
  // otherwise an error (0/1/2) or a warning (3/4).
  const resolveCoord = buildStopCoordResolver(
    rows as unknown as Stops[],
    allRows(c.s, 'pathways') as unknown as Pathways[]
  );
  const ids = new Set<string>();
  for (let index = 0; index < rows.length; index++) {
    if (index > 0 && index % CONFIG.VALIDATE_CHUNK_ROWS === 0) {
      yield;
    }
    const stop = rows[index];
    const rowNum = index + 1;
    const id = stop.stop_id ?? '';
    if (id.trim() === '') {
      c.error(
        `Row ${rowNum}: stop_id is required`,
        'MISSING_REQUIRED_FIELD',
        file,
        rowNum
      );
    } else {
      if (ids.has(id)) {
        c.error(
          `Row ${rowNum}: Duplicate stop_id '${id}'`,
          'DUPLICATE_ID',
          file,
          rowNum
        );
      }
      ids.add(id);
    }
    if ((stop.stop_name ?? '').trim() === '') {
      c.error(
        `Row ${rowNum}: stop_name is required`,
        'MISSING_REQUIRED_FIELD',
        file,
        rowNum
      );
    }

    const lat = (stop.stop_lat ?? '').trim();
    const lon = (stop.stop_lon ?? '').trim();
    if (lat !== '' && !isValidLatitude(lat)) {
      c.error(
        `Row ${rowNum}: stop_lat must be between -90.0 and 90.0`,
        'INVALID_COORDINATE',
        file,
        rowNum
      );
    }
    if (lon !== '' && !isValidLongitude(lon)) {
      c.error(
        `Row ${rowNum}: stop_lon must be between -180.0 and 180.0`,
        'INVALID_COORDINATE',
        file,
        rowNum
      );
    }

    const locType = (stop.location_type ?? '').trim() || '0';
    const coordRequiredByType =
      locType === '0' || locType === '1' || locType === '2';
    if (!hasValidCoords(stop as unknown as Stops)) {
      const hasAncestorCoords = id !== '' && resolveCoord(id) !== null;
      if (coordRequiredByType && !hasAncestorCoords) {
        c.error(
          `Row ${rowNum}: stop_lat/stop_lon are required for location_type=${locType} (no coord-having parent_station)`,
          'MISSING_REQUIRED_FIELD',
          file,
          rowNum
        );
      } else if (coordRequiredByType) {
        c.warning(
          `Row ${rowNum}: stop_lat/stop_lon missing for location_type=${locType}; rendering via parent_station coords`,
          'MISSING_COORDS_INHERITED',
          file,
          rowNum
        );
      } else if (!hasAncestorCoords) {
        c.warning(
          `Row ${rowNum}: stop has no own coords and no coord-having parent_station, will not render`,
          'ORPHANED_STOP',
          file,
          rowNum,
          { file, id: rowId('stops', stop), field: 'stop_lat', value: '' }
        );
      }
    }

    if (stop.location_type && !['0', '1', '2', '3', '4'].includes(locType)) {
      c.warning(
        `Row ${rowNum}: Unknown location_type '${stop.location_type}'`,
        'UNKNOWN_LOCATION_TYPE',
        file,
        rowNum
      );
    }
  }
  c.addInfo(`Found ${rows.length} stops`, 'STOP_COUNT');
}

function* trips(c: Sweep): Pass {
  const file = GTFS_TABLES.TRIPS;
  if (!c.has('trips')) {
    c.error('trips.txt is empty', 'EMPTY_FILE', file);
    return;
  }
  const ids = new Set<string>();
  yield* eachRow(c.s, 'trips', (trip, index) => {
    const rowNum = index + 1;
    const id = trip.trip_id ?? '';
    if (id.trim() === '') {
      c.error(
        `Row ${rowNum}: trip_id is required`,
        'MISSING_REQUIRED_FIELD',
        file,
        rowNum
      );
    } else {
      if (ids.has(id)) {
        c.error(
          `Row ${rowNum}: Duplicate trip_id '${id}'`,
          'DUPLICATE_ID',
          file,
          rowNum
        );
      }
      ids.add(id);
    }
    for (const field of ['route_id', 'service_id']) {
      if ((trip[field] ?? '').trim() === '') {
        c.error(
          `Row ${rowNum}: ${field} is required`,
          'MISSING_REQUIRED_FIELD',
          file,
          rowNum
        );
      }
    }
  });
  c.addInfo(`Found ${c.counts.trips} trips`, 'TRIP_COUNT');
}

// ─── stop_times ──────────────────────────────────────────────────────────────

/** An invalid or unclean time in the base patterns. */
interface TimeIssue {
  /** Trip index in the patterns. */
  t: number;
  /** Row offset within the trip. */
  k: number;
  field: string;
  value: string;
}

/** Progress of the one-time scan of a base's pattern times. */
interface TimeScan {
  next: number;
  issues: TimeIssue[];
}

const timeScans = new WeakMap<Patterns, TimeScan>();

/**
 * The bad times of every pattern trip, edited or not, scanned once per base.
 * Progress is kept across sweeps, so a restarted sweep picks the scan up
 * where the last one left it.
 */
function* baseTimeIssues(p: Patterns): Generator<void, TimeIssue[], void> {
  let scan = timeScans.get(p);
  if (!scan) {
    scan = { next: 0, issues: [] };
    timeScans.set(p, scan);
  }
  const cols: [string, NonNullable<Patterns['arr']>][] = [];
  if (p.arr) {
    cols.push(['arrival_time', p.arr]);
  }
  if (p.dep) {
    cols.push(['departure_time', p.dep]);
  }
  let rows = 0;
  while (scan.next < p.tripCount) {
    const tr = scan.next;
    const start = p.tripTimeStart[tr];
    const len = p.tripLength(tr);
    for (let k = 0; k < len; k++) {
      for (const [field, col] of cols) {
        const value = col.get(start + k);
        if (
          value !== '' &&
          (!isValidTime(value) || UNCLEAN_VALUE.test(value))
        ) {
          scan.issues.push({ t: tr, k, field, value });
        }
      }
    }
    scan.next++;
    rows += len;
    if (rows >= CONFIG.VALIDATE_CHUNK_ROWS) {
      rows = 0;
      yield;
    }
  }
  return scan.issues;
}

/** INVALID_TIME_FORMAT and UNCLEAN_VALUE issues of one time value. */
function timeIssues(field: string, value: string, out: RowIssue[]): void {
  if (value === '') {
    return;
  }
  if (!isValidTime(value)) {
    out.push({
      level: 'error',
      code: 'INVALID_TIME_FORMAT',
      text: `${field} format is invalid`,
    });
  }
  if (UNCLEAN_VALUE.test(value)) {
    out.push({
      level: 'warning',
      code: 'UNCLEAN_VALUE',
      text: `${field} ${JSON.stringify(value)} has surrounding whitespace or a control character`,
      entity: { field, value },
    });
  }
}

const TIME_FIELDS = new Set(['arrival_time', 'departure_time']);
const TRIP_AND_TIMES = new Set(['trip_id', 'arrival_time', 'departure_time']);
const FLEX_PAIRS = ['2:1', '1:2'];

/**
 * Every stop_times rule: required fields, numbers and times, conditional
 * presence, foreign keys, zone references, whitespace and flex pairing.
 */
function* stopTimes(c: Sweep): Pass {
  const s = c.s;
  const file = STOP_TIMES;
  if (!c.has('stop_times')) {
    c.error('stop_times.txt is empty', 'EMPTY_FILE', file);
    return;
  }
  const edited = new Set(s.editedTripIds());
  const allChecks = foreignKeyChecks(c, file);
  const tripCheck = allChecks.find((check) => check.field === 'trip_id');
  const checks = allChecks.filter((check) => check.field !== 'trip_id');

  const keyOf = (trip: string, seq: string): string =>
    rowId('stop_times', { trip_id: trip, stop_sequence: seq });
  const report = (issue: RowIssue, trip: string, seq: string): void => {
    const id = keyOf(trip, seq);
    c.push(
      issue.level,
      `Trip '${trip}' stop_sequence ${seq}: ${issue.text}`,
      issue.code,
      file,
      null,
      issue.entity ? { file, id, ...issue.entity } : null
    );
  };

  /** The rules of one row that hold for every trip sharing its pattern. */
  const sharedIssues = (row: Row, out: RowIssue[], withFlex: boolean) => {
    const seq = row.stop_sequence ?? '';
    if (seq === '') {
      out.push({
        level: 'error',
        code: 'MISSING_REQUIRED_FIELD',
        text: 'stop_sequence is required',
      });
    } else if (isNaN(parseInt(seq))) {
      out.push({
        level: 'error',
        code: 'INVALID_NUMBER',
        text: 'stop_sequence must be a number',
      });
    }
    if (withFlex) {
      conditionalIssue(row, out);
    }
    foreignKeyIssues(checks, row, out);
    const location = (row.location_id ?? '').trim();
    if (location !== '' && !c.zoneIds.has(location)) {
      out.push({
        level: 'error',
        code: 'INVALID_REFERENCE',
        text: `location_id '${location}' not found in locations.geojson`,
        entity: { field: 'location_id', value: location },
      });
    }
    whitespaceIssues(row, out, TRIP_AND_TIMES);
  };

  /** The rules that read the trip_id or the times. */
  const tripIssues = (
    trip: string,
    row: Row,
    out: RowIssue[],
    withTimes: boolean
  ) => {
    if (trip.trim() === '') {
      out.push({
        level: 'error',
        code: 'MISSING_REQUIRED_FIELD',
        text: 'trip_id is required',
      });
    } else if (tripCheck && !tripCheck.known.has(trip)) {
      out.push({
        level: 'error',
        code: 'INVALID_REFERENCE',
        text: `trip_id '${trip}' not found in ${tripCheck.targetNames}`,
        entity: { field: 'trip_id', value: trip },
      });
    }
    if (UNCLEAN_VALUE.test(trip)) {
      out.push({
        level: 'warning',
        code: 'UNCLEAN_VALUE',
        text: `trip_id ${JSON.stringify(trip)} has surrounding whitespace or a control character`,
        entity: { field: 'trip_id', value: trip },
      });
    }
    if (withTimes) {
      for (const field of TIME_FIELDS) {
        timeIssues(field, row[field] ?? '', out);
      }
    }
  };

  // Flex pairing: which refs each stop list uses, and how often.
  type Candidate = { k: number; ref: string; pair: string };
  const refOf = (row: Row): string | null => {
    const group = (row.location_group_id ?? '').trim();
    if (group !== '') {
      return `location_group:${group}`;
    }
    const location = (row.location_id ?? '').trim();
    return location !== '' ? `location:${location}` : null;
  };
  const pairOf = (row: Row): string =>
    `${(row.pickup_type ?? '').trim()}:${(row.drop_off_type ?? '').trim()}`;
  const flexLists: {
    tripIds: string[];
    rows: Row[];
    refCounts: Map<string, number>;
    candidates: Candidate[];
  }[] = [];

  const lists: string[][] = [];
  s.forEachStopList((_stops, tripIds) => {
    lists.push(tripIds);
  });

  let done = 0;
  for (const tripIds of lists) {
    const isEdited = tripIds.length === 1 && edited.has(tripIds[0]);
    const rows = s.stopTimesForTrip(tripIds[0]);
    // A pickup/drop-off window makes the conditional rules read the times,
    // which differ per trip.
    const windowed = rows.some(
      (r) =>
        (r.start_pickup_drop_off_window ?? '') !== '' ||
        (r.end_pickup_drop_off_window ?? '') !== ''
    );
    const shared = rows.map((row) => {
      const out: RowIssue[] = [];
      sharedIssues(row, out, !windowed);
      return out;
    });

    const candidates: Candidate[] = [];
    const refCounts = new Map<string, number>();
    rows.forEach((row, k) => {
      const ref = refOf(row);
      if (ref === null) {
        return;
      }
      refCounts.set(ref, (refCounts.get(ref) ?? 0) + 1);
      const pair = pairOf(row);
      if (FLEX_PAIRS.includes(pair)) {
        candidates.push({ k, ref, pair });
      }
    });
    if (candidates.length > 0) {
      flexLists.push({ tripIds, rows, refCounts, candidates });
    }

    for (const trip of tripIds) {
      const tripRows = windowed ? s.stopTimesForTrip(trip) : rows;
      tripRows.forEach((row, k) => {
        const seq = row.stop_sequence ?? '';
        const out: RowIssue[] = [];
        tripIssues(trip, row, out, isEdited);
        if (windowed) {
          conditionalIssue(row, out);
        }
        for (const issue of shared[k]) {
          report(issue, trip, seq);
        }
        for (const issue of out) {
          report(issue, trip, seq);
        }
      });
      done += rows.length;
      if (done >= CONFIG.VALIDATE_CHUNK_ROWS) {
        done = 0;
        yield;
      }
    }
  }

  // Times of the unedited trips, from the per-base scan.
  const p = s.patterns;
  if (p) {
    const issues = yield* baseTimeIssues(p);
    const refsOf = new Map<number, { stop_sequence: string }[]>();
    for (const issue of issues) {
      const trip = p.tripId(issue.t);
      if (edited.has(trip)) {
        continue;
      }
      const pat = p.tripPattern[issue.t];
      let refs = refsOf.get(pat);
      if (!refs) {
        refs = p.patternStopRefs(pat);
        refsOf.set(pat, refs);
      }
      const out: RowIssue[] = [];
      timeIssues(issue.field, issue.value, out);
      for (const one of out) {
        report(one, trip, refs[issue.k].stop_sequence);
      }
    }
  }

  yield* flexPairing(c, flexLists, report);
  c.addInfo(`Found ${c.counts.stop_times} stop times`, 'STOP_TIME_COUNT');
}

function conditionalIssue(row: Row, out: RowIssue[]): void {
  const problem = validateFlexStopTimeRow(row);
  if (problem) {
    out.push({ level: 'error', code: 'CONDITIONAL_PRESENCE', text: problem });
  }
}

/**
 * The documented on-demand shape serves a zone with a *pair* of stop_times on
 * one trip: the pickup record `(pickup_type=2, drop_off_type=1)` then the
 * drop-off record `(1,2)`. A trip carrying only one half is legal - a zone can
 * be pickup-only - so this is a warning, and only raised when the same route
 * pairs that same ref up on some other trip, which is what makes a lone half
 * look like an omission rather than a decision. Nothing is auto-created.
 */
function* flexPairing(
  c: Sweep,
  lists: {
    tripIds: string[];
    rows: Row[];
    refCounts: Map<string, number>;
    candidates: { k: number; ref: string; pair: string }[];
  }[],
  report: (issue: RowIssue, trip: string, seq: string) => void
): Pass {
  if (lists.length === 0) {
    return;
  }
  const routeOfTrip = new Map<string, string>();
  c.s.scan('trips', ['trip_id', 'route_id'], ([trip, route]) => {
    routeOfTrip.set(trip, route);
  });
  yield;
  // `route_id|ref` -> which halves of the pair the route uses anywhere.
  const halvesPerRoute = new Map<string, Set<string>>();
  for (const list of lists) {
    for (const trip of list.tripIds) {
      for (const { ref, pair } of list.candidates) {
        const key = `${routeOfTrip.get(trip) ?? ''}|${ref}`;
        const halves = halvesPerRoute.get(key) ?? new Set<string>();
        halves.add(pair);
        halvesPerRoute.set(key, halves);
      }
    }
  }
  for (const list of lists) {
    for (const trip of list.tripIds) {
      for (const { k, ref, pair } of list.candidates) {
        if ((list.refCounts.get(ref) ?? 0) !== 1) {
          continue;
        }
        const key = `${routeOfTrip.get(trip) ?? ''}|${ref}`;
        if ((halvesPerRoute.get(key)?.size ?? 0) < 2) {
          continue;
        }
        const missing = pair === '2:1' ? '(1, 2)' : '(2, 1)';
        report(
          {
            level: 'warning',
            code: 'UNPAIRED_FLEX_ROW',
            text: `uses ${ref.replace(':', ' ')} once, with pickup_type/drop_off_type ${pair.replace(':', ', ')}. Other trips on this route pair it with a ${missing} row - did you mean to add one?`,
            entity: { field: 'pickup_type', value: pair },
          },
          trip,
          list.rows[k].stop_sequence ?? ''
        );
      }
    }
  }
}

// ─── shapes ──────────────────────────────────────────────────────────────────

/** Progress of the one-time scan of a base's shapes. */
interface ShapeScan {
  ids: string[];
  next: number;
  issues: { shapeId: string; seq: string; issue: RowIssue }[];
}

const shapeScans = new WeakMap<ShapeTable, ShapeScan>();

/** The per-point rules of shapes.txt, whitespace included. */
function shapeRowIssues(row: Row, out: RowIssue[]): void {
  const required = (field: string) =>
    out.push({
      level: 'error',
      code: 'MISSING_REQUIRED_FIELD',
      text: `${field} is required`,
    });
  if ((row.shape_id ?? '').trim() === '') {
    required('shape_id');
  }
  const lat = row.shape_pt_lat ?? '';
  if (lat === '') {
    required('shape_pt_lat');
  } else if (!isValidLatitude(lat)) {
    out.push({
      level: 'error',
      code: 'INVALID_COORDINATE',
      text: 'shape_pt_lat must be between -90.0 and 90.0',
    });
  }
  const lon = row.shape_pt_lon ?? '';
  if (lon === '') {
    required('shape_pt_lon');
  } else if (!isValidLongitude(lon)) {
    out.push({
      level: 'error',
      code: 'INVALID_COORDINATE',
      text: 'shape_pt_lon must be between -180.0 and 180.0',
    });
  }
  const seq = row.shape_pt_sequence ?? '';
  if (seq === '') {
    required('shape_pt_sequence');
  } else if (isNaN(parseInt(seq))) {
    out.push({
      level: 'error',
      code: 'INVALID_NUMBER',
      text: 'shape_pt_sequence must be a number',
    });
  }
  whitespaceIssues(row, out);
}

/** Issues of every base shape, edited or not, scanned once per base. */
function* baseShapeIssues(sh: ShapeTable): Generator<void, ShapeScan, void> {
  let scan = shapeScans.get(sh);
  if (!scan) {
    scan = { ids: sh.shapeIds(), next: 0, issues: [] };
    shapeScans.set(sh, scan);
  }
  let rows = 0;
  while (scan.next < scan.ids.length) {
    const shapeId = scan.ids[scan.next];
    for (const row of sh.shapeRows(shapeId)) {
      const out: RowIssue[] = [];
      shapeRowIssues(row, out);
      for (const issue of out) {
        scan.issues.push({ shapeId, seq: row.shape_pt_sequence ?? '', issue });
      }
      rows++;
    }
    scan.next++;
    if (rows >= CONFIG.VALIDATE_CHUNK_ROWS) {
      rows = 0;
      yield;
    }
  }
  return scan;
}

function* shapes(c: Sweep): Pass {
  const s = c.s;
  if (!c.has('shapes')) {
    return;
  }
  const file = SHAPES;
  const report = (issue: RowIssue, shapeId: string, seq: string) => {
    c.push(
      issue.level,
      `Shape '${shapeId}' point ${seq}: ${issue.text}`,
      issue.code,
      file,
      null,
      issue.entity
        ? {
            file,
            id: rowId('shapes', { shape_id: shapeId, shape_pt_sequence: seq }),
            ...issue.entity,
          }
        : null
    );
  };
  const edited = s.editedShapeIds();
  const editedSet = new Set(edited);
  if (s.shapes) {
    const scan = yield* baseShapeIssues(s.shapes);
    for (const { shapeId, seq, issue } of scan.issues) {
      if (!editedSet.has(shapeId)) {
        report(issue, shapeId, seq);
      }
    }
  }
  for (const shapeId of edited) {
    for (const row of s.shapeRows(shapeId)) {
      const out: RowIssue[] = [];
      shapeRowIssues(row, out);
      for (const issue of out) {
        report(issue, shapeId, row.shape_pt_sequence ?? '');
      }
    }
  }
  c.addInfo(`Found ${c.counts.shapes} shape points`, 'SHAPE_POINT_COUNT');
}

// ─── Other tables ────────────────────────────────────────────────────────────

function* calendar(c: Sweep): Pass {
  const calFile = GTFS_TABLES.CALENDAR;
  allRows(c.s, 'calendar').forEach((service, index) => {
    const rowNum = index + 1;
    const serviceId = rowId('calendar', service);
    if ((service.service_id ?? '').trim() === '') {
      c.error(
        `Row ${rowNum}: service_id is required`,
        'MISSING_REQUIRED_FIELD',
        calFile,
        rowNum
      );
    }
    for (const field of ['start_date', 'end_date']) {
      const value = service[field] ?? '';
      if (value && !isValidDate(value)) {
        c.error(
          `Row ${rowNum}: ${field} '${value}' is invalid (should be YYYYMMDD)`,
          'INVALID_DATE_FORMAT',
          calFile,
          rowNum,
          { file: calFile, id: serviceId, field, value }
        );
      }
    }
  });

  const file = GTFS_TABLES.CALENDAR_DATES;
  yield* eachRow(c.s, 'calendar_dates', (exception, index) => {
    const rowNum = index + 1;
    if ((exception.service_id ?? '').trim() === '') {
      c.error(
        `Row ${rowNum}: service_id is required`,
        'MISSING_REQUIRED_FIELD',
        file,
        rowNum
      );
    }
    const date = exception.date ?? '';
    if (!date || !isValidDate(date)) {
      c.error(
        `Row ${rowNum}: date '${date}' is invalid (should be YYYYMMDD)`,
        'INVALID_DATE_FORMAT',
        file,
        rowNum,
        {
          file,
          id: rowId('calendar_dates', exception),
          field: 'date',
          value: date,
        }
      );
    }
    if (!['1', '2'].includes(exception.exception_type ?? '')) {
      c.error(
        `Row ${rowNum}: exception_type must be 1 or 2`,
        'INVALID_EXCEPTION_TYPE',
        file,
        rowNum
      );
    }
  });
}

/** Trips with no stop_times. */
function* references(c: Sweep): Pass {
  if (!c.s.hasTable('trips') || !c.has('stop_times')) {
    return;
  }
  const file = GTFS_TABLES.TRIPS;
  const ids: string[] = [];
  c.s.scan('trips', ['trip_id'], ([id]) => {
    ids.push(id);
  });
  for (let i = 0; i < ids.length; i++) {
    if (i > 0 && i % CONFIG.VALIDATE_CHUNK_ROWS === 0) {
      yield;
    }
    const id = ids[i];
    if (c.s.stopListKey(id) === null) {
      c.warning(
        `Trip '${id}' has no stop times`,
        'TRIP_WITHOUT_STOP_TIMES',
        file,
        null,
        { file, id, field: 'trip_id', value: id }
      );
    }
  }
}

/**
 * networks.txt and route_networks.txt are Conditionally Forbidden: the
 * reference forbids them when routes.txt carries a network_id column, since
 * the two forms would disagree about which routes are in which network.
 */
function networks(c: Sweep): void {
  if (!c.has('networks') && !c.has('route_networks')) {
    return;
  }
  let inline = 0;
  c.s.scan('routes', ['network_id'], ([id]) => {
    if (id.trim() !== '') {
      inline++;
    }
  });
  if (inline > 0) {
    c.error(
      `network_id is set on ${inline} route(s) in routes.txt, which is forbidden when networks.txt or route_networks.txt is present. Those values are ignored and will not be exported.`,
      'NETWORK_ID_CONFLICT',
      GTFS_TABLES.ROUTES
    );
  }
}

/**
 * Only stops (location_type 0) and stations (1) can belong to an area: an
 * entrance, a generic node or a boarding area is not somewhere a fare leg
 * begins or ends.
 */
function stopAreas(c: Sweep): void {
  const rows = allRows(c.s, 'stop_areas');
  if (rows.length === 0) {
    return;
  }
  const typeByStopId = new Map<string, number>();
  c.s.scan('stops', ['stop_id', 'location_type'], ([id, type]) => {
    typeByStopId.set(id, stopLocationType({ location_type: type }));
  });
  rows.forEach((row, index) => {
    const stopId = row.stop_id ?? '';
    const locationType = typeByStopId.get(stopId);
    if (
      locationType !== undefined &&
      locationType !== 0 &&
      locationType !== 1
    ) {
      c.error(
        `Row ${index + 1}: stop '${stopId}' has location_type ${locationType}, which cannot be assigned to an area`,
        'INVALID_AREA_ASSIGNMENT',
        GTFS_TABLES.STOP_AREAS,
        index + 1
      );
    }
  });
}

/**
 * The flex rules the generic sweeps cannot express: the locations.geojson
 * features, and `location_group_id` sharing one ID namespace with
 * `stops.stop_id` and locations.geojson `id`. stop_times.location_id is
 * checked in the stop_times pass.
 */
function flexLocations(c: Sweep): void {
  c.zones.forEach((feature, index) => {
    zoneFeature(c, feature, String(feature.id ?? '').trim(), index + 1);
  });

  const groups = allRows(c.s, 'location_groups');
  if (groups.length === 0) {
    return;
  }
  const owners = new Map<string, string>();
  c.s.scan('stops', ['stop_id'], ([id]) => {
    if (id.trim() !== '') {
      owners.set(id.trim(), t('ids.ownerStop'));
    }
  });
  for (const id of c.zoneIds) {
    owners.set(id, t('ids.ownerZone'));
  }
  const file = GTFS_TABLES.LOCATION_GROUPS;
  groups.forEach((row, index) => {
    const id = (row.location_group_id ?? '').trim();
    const problem = validateLocationGroupId(id, owners);
    if (problem) {
      c.error(`Row ${index + 1}: ${problem}`, 'DUPLICATE_ID', file, index + 1, {
        file,
        id: rowId('location_groups', row),
        field: 'location_group_id',
        value: id,
      });
    }
  });
}

/**
 * The per-feature rules of locations.geojson: an id, and a polygon. A feature
 * that breaks either is kept, so this is what tells the user to fix it on the
 * zone's page.
 */
function zoneFeature(
  c: Sweep,
  feature: GeoJSON.Feature,
  id: string,
  featureNum: number
): void {
  const file = GTFS_TABLES.LOCATIONS_GEOJSON;
  const where = id !== '' ? `Zone '${id}'` : `Feature ${featureNum}`;
  const entity = { file, id: id || String(featureNum) };
  if (id === '') {
    c.error(
      `Feature ${featureNum}: every locations.geojson feature must have an id, unique across stops.stop_id, locations.geojson id and location_group_id`,
      'MISSING_REQUIRED_FIELD',
      file,
      featureNum,
      { ...entity, field: 'id', value: '' }
    );
  }
  const geometry = feature.geometry as GeoJSON.Geometry | null | undefined;
  if (geometry?.type !== 'Polygon' && geometry?.type !== 'MultiPolygon') {
    c.error(
      `${where}: geometry is ${String(geometry?.type)}, must be a Polygon or MultiPolygon`,
      'INVALID_GEOMETRY',
      file,
      featureNum,
      { ...entity, field: 'geometry', value: String(geometry?.type) }
    );
    return;
  }
  if (geometry.coordinates.length === 0) {
    c.error(
      `${where}: geometry has no coordinates`,
      'INVALID_GEOMETRY',
      file,
      featureNum,
      { ...entity, field: 'geometry', value: '' }
    );
  }
}

/**
 * The row-level conditional-presence rules the fares and on-demand editors
 * enforce on every edit, applied to whatever the feed arrived with.
 * stop_times' rule runs in the stop_times pass.
 */
function* conditionalPresence(c: Sweep): Pass {
  const checks: [string, (row: Record<string, unknown>) => string | null][] = [
    [GTFS_TABLES.TIMEFRAMES, validateTimeframeRow],
    [GTFS_TABLES.FARE_LEG_JOIN_RULES, validateFareLegJoinRuleRow],
    [GTFS_TABLES.FARE_TRANSFER_RULES, validateFareTransferRuleRow],
    [GTFS_TABLES.BOOKING_RULES, validateBookingRuleRow],
    [GTFS_TABLES.TRANSFERS, validateTransferRow],
  ];
  for (const [file, check] of checks) {
    yield* eachRow(c.s, tableOf(file), (row, index) => {
      const problem = check(row);
      if (problem) {
        c.error(
          `Row ${index + 1}: ${problem}`,
          'CONDITIONAL_PRESENCE',
          file,
          index + 1
        );
      }
    });
  }
}

/**
 * Headway periods, judged by the same rules the timetable band enforces on
 * an edit. A dangling trip_id is left to the foreign key pass.
 */
function frequencies(c: Sweep): void {
  const rows = allRows(c.s, 'frequencies');
  if (rows.length === 0) {
    return;
  }
  const file = GTFS_TABLES.FREQUENCIES;
  const keyCounts = new Map<string, number>();
  for (const row of rows) {
    const key = frequencyPeriodKey(row);
    keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
  }
  // Periods per trip, earliest first. Duplicates are left out: two rows on
  // one key would otherwise report as overlapping each other.
  const byTrip = new Map<string, Row[]>();
  for (const row of rows) {
    const trip = (row.trip_id ?? '').trim();
    if (trip === '' || (keyCounts.get(frequencyPeriodKey(row)) ?? 0) > 1) {
      continue;
    }
    byTrip.set(trip, [...(byTrip.get(trip) ?? []), row]);
  }
  // An unparseable start_time sorts last rather than as 0, or a garbage row
  // would appear to overlap everything.
  const startOf = (row: Row): number =>
    TimeFormatter.timeToSeconds((row.start_time ?? '').trim()) ??
    Number.MAX_SAFE_INTEGER;
  for (const group of byTrip.values()) {
    group.sort((a, b) => startOf(a) - startOf(b));
  }

  rows.forEach((row, index) => {
    const line = index + 1;
    const id = frequencyPeriodKey(row);
    const at = (field: string): ValidationEntity => ({
      file,
      id,
      field,
      value: row[field] ?? '',
    });
    if ((keyCounts.get(id) ?? 0) > 1) {
      c.error(
        `Row ${line}: trip_id '${row.trip_id ?? ''}' has more than one headway period starting at '${row.start_time ?? ''}'. Only one of them is reachable in the timetable, so the duplicate has to be removed in the file.`,
        'DUPLICATE_KEY',
        file,
        line,
        at('start_time')
      );
    }
    const problem = frequencyRowProblem(row);
    if (problem) {
      c.error(
        `Row ${line}: ${problem.message}`,
        'CONDITIONAL_PRESENCE',
        file,
        line,
        at(problem.field)
      );
      return;
    }
    // An overlapping pair is reported once, on the later-starting period.
    const group = byTrip.get((row.trip_id ?? '').trim()) ?? [];
    const position = group.indexOf(row);
    if (position > 0) {
      const overlap = frequencyRowProblem(row, group.slice(0, position));
      if (overlap?.kind === 'overlap') {
        c.error(
          `Row ${line}: ${overlap.message}`,
          'FREQUENCY_OVERLAP',
          file,
          line,
          at(overlap.field)
        );
      }
    }
    if (frequencyEndIsAmbiguous(row)) {
      c.warning(
        `Row ${line}: end_time '${row.end_time ?? ''}' lands exactly on a departure of this exact_times=1 period, so whether that last trip runs is ambiguous. end_time should fall between the last departure and the one after it.`,
        'FREQUENCY_END_AMBIGUOUS',
        file,
        line,
        at('end_time')
      );
    }
  });
}

/**
 * Where several rider categories are eligible for the same fare product,
 * exactly one of them must be the default.
 */
function riderCategoryDefaults(c: Sweep): void {
  const categories = allRows(c.s, 'rider_categories');
  if (categories.length === 0) {
    return;
  }
  const isDefault = new Map(
    categories.map((row) => [
      row.rider_category_id ?? '',
      (row.is_default_fare_category ?? '').trim() === '1',
    ])
  );
  const categoriesByProduct = new Map<string, Set<string>>();
  for (const product of allRows(c.s, 'fare_products')) {
    const productId = product.fare_product_id ?? '';
    const categoryId = (product.rider_category_id ?? '').trim();
    if (productId === '' || categoryId === '') {
      continue;
    }
    const set = categoriesByProduct.get(productId) ?? new Set<string>();
    set.add(categoryId);
    categoriesByProduct.set(productId, set);
  }
  for (const [productId, eligible] of categoriesByProduct) {
    if (eligible.size < 2) {
      continue;
    }
    const defaults = [...eligible].filter((id) => isDefault.get(id) === true);
    if (defaults.length !== 1) {
      c.error(
        `fare_product_id '${productId}' is eligible for ${eligible.size} rider categories but ${defaults.length} of them are marked is_default_fare_category=1; exactly one is required`,
        'RIDER_CATEGORY_DEFAULT',
        GTFS_TABLES.RIDER_CATEGORIES
      );
    }
  }
}

/**
 * Every foreign key the spec declares on the ordinary tables (stop_times'
 * run in its own pass). A field naming two tables matches a value in either.
 * Empty values are skipped. The match is exact, never trimmed: an id with
 * stray whitespace points at nothing, and the whitespace pass names why.
 */
function* foreignKeys(c: Sweep): Pass {
  const files = new Set(GTFS_FOREIGN_KEYS.map((ref) => ref.file));
  for (const file of files) {
    if (file === STOP_TIMES) {
      continue;
    }
    if (file === SHAPES) {
      throw new Error(
        '[FeedValidator] foreign keys on shapes.txt are not checked'
      );
    }
    const table = tableOf(file);
    if (!c.has(table)) {
      continue;
    }
    const checks = foreignKeyChecks(c, file);
    if (checks.length === 0) {
      continue;
    }
    yield* eachRow(c.s, table, (row, index) => {
      const out: RowIssue[] = [];
      foreignKeyIssues(checks, row, out);
      for (const issue of out) {
        c.error(
          `Row ${index + 1}: ${issue.text}`,
          issue.code,
          file,
          index + 1,
          { file, id: rowId(table, row), ...issue.entity! }
        );
      }
    });
  }
}

/**
 * Translations that name nothing: a record that no longer exists, a
 * `field_value` no row holds any more, a field the table does not have, or
 * feed_info text in a feed without feed_info. An unknown `table_name` is left
 * to the enum check.
 */
function* translations(c: Sweep): Pass {
  const file = GTFS_TABLES.TRANSLATIONS;
  if (!c.has('translations')) {
    return;
  }
  const s = c.s;
  const tables = new Set(translatableTables());
  const fieldsByTable = new Map<string, Set<string>>();
  const recordsByTable = new Map<string, Set<string>>();

  const hasRecord = (
    table: string,
    ids: { id: string; sub?: string },
    recordId: string,
    recordSubId: string
  ): boolean => {
    const sub = ids.sub ? recordSubId : '';
    if (table === 'stop_times') {
      return s
        .tripStops(recordId)
        .some((row) => !ids.sub || row.stop_sequence === sub);
    }
    let records = recordsByTable.get(table);
    if (!records) {
      records = new Set();
      const target = records;
      const cols = ids.sub ? [ids.id, ids.sub] : [ids.id];
      if (s.hasTable(table)) {
        s.scan(table, cols, ([id, subValue]) => {
          target.add(`${id}\u0000${ids.sub ? subValue : ''}`);
        });
      }
      recordsByTable.set(table, records);
    }
    return records.has(`${recordId}\u0000${sub}`);
  };

  yield* eachRow(s, 'translations', (row, index) => {
    const rowNum = index + 1;
    const table = row.table_name ?? '';
    if (!tables.has(table)) {
      return;
    }
    const tableFile = `${table}.txt`;
    const field = row.field_name ?? '';
    const recordId = row.record_id ?? '';
    const recordSubId = row.record_sub_id ?? '';
    const fieldValue = row.field_value ?? '';
    const warn = (message: string, code: string, entityField: string) =>
      c.warning(`Row ${rowNum}: ${message}`, code, file, rowNum, {
        file,
        id: rowId('translations', row),
        field: entityField,
        value: row[entityField] ?? '',
      });

    let fields = fieldsByTable.get(table);
    if (!fields) {
      fields = new Set([
        ...Object.keys(GTFS_FIELD_SPECS[tableFile] ?? {}),
        ...s.columns(table),
        ...(c.extensionColumns[tableFile] ?? []),
      ]);
      fieldsByTable.set(table, fields);
    }
    if (!fields.has(field)) {
      warn(
        `field_name '${field}' is not a field of ${table}`,
        'TRANSLATION_UNKNOWN_FIELD',
        'field_name'
      );
      return;
    }

    if (table === 'feed_info') {
      if (!c.has('feed_info')) {
        warn(
          `translates feed_info.${field}, but the feed has no feed_info`,
          'TRANSLATION_ORPHANED_RECORD',
          'table_name'
        );
      }
      return;
    }

    if (recordId !== '') {
      const ids = translationRecordFields(table);
      if (ids && !hasRecord(table, ids, recordId, recordSubId)) {
        const named = ids.sub ? `${recordId}, ${recordSubId}` : recordId;
        warn(
          `record_id '${named}' not found in ${table}.${ids.id}${ids.sub ? ` + ${ids.sub}` : ''}`,
          'TRANSLATION_ORPHANED_RECORD',
          'record_id'
        );
      }
      return;
    }

    if (fieldValue !== '' && !c.values(table, field).has(fieldValue)) {
      warn(
        `field_value '${fieldValue}' not found in ${table}.${field}`,
        'TRANSLATION_ORPHANED_VALUE',
        'field_value'
      );
    }
  });
}

/**
 * Values carrying leading/trailing whitespace or an embedded control
 * character, across the ordinary tables (stop_times and shapes are checked
 * in their own passes). Invisible in every rendering, so they are reported
 * as their own issue, which gives the reference error they cause a cause.
 */
function* fieldWhitespace(c: Sweep): Pass {
  for (const file of Object.values(GTFS_TABLES)) {
    const table = tableOf(file);
    if (
      !file.endsWith('.txt') ||
      file === STOP_TIMES ||
      file === SHAPES ||
      !c.has(table)
    ) {
      continue;
    }
    yield* eachRow(c.s, table, (row, index) => {
      const out: RowIssue[] = [];
      whitespaceIssues(row, out);
      for (const issue of out) {
        c.warning(
          `Row ${index + 1}: ${issue.text}`,
          issue.code,
          file,
          index + 1,
          { file, id: rowId(table, row), ...issue.entity! }
        );
      }
    });
  }
}

/**
 * Language, timezone and currency values that no standard recognises: every
 * field the reference types as one of the three, in every table.
 */
function* constrainedCodes(c: Sweep): Pass {
  const checks: Record<
    string,
    { label: string; valid: (v: string) => boolean }
  > = {
    [GTFSFieldType.LanguageCode]: {
      label: 'a valid IETF BCP 47 language code',
      valid: isValidLanguageCode,
    },
    [GTFSFieldType.Timezone]: {
      label: 'a valid IANA timezone',
      valid: isValidTimezone,
    },
    [GTFSFieldType.CurrencyCode]: {
      label: 'a 3-letter ISO 4217 currency code',
      valid: isValidCurrencyCode,
    },
  };
  for (const file of Object.values(GTFS_TABLES)) {
    const specs = GTFS_FIELD_SPECS[file];
    if (!specs) {
      continue;
    }
    const constrained = Object.entries(specs)
      .map(([field, spec]) => ({
        field,
        check: checks[mapGTFSTypeString(spec.type)],
      }))
      .filter((entry) => entry.check !== undefined);
    const table = tableOf(file);
    if (constrained.length === 0 || !c.has(table)) {
      continue;
    }
    if (file === STOP_TIMES || file === SHAPES) {
      throw new Error(`[FeedValidator] codes on ${file} are not checked`);
    }
    yield* eachRow(c.s, table, (row, index) => {
      for (const { field, check } of constrained) {
        const value = (row[field] ?? '').trim();
        if (value === '' || check.valid(value)) {
          continue;
        }
        c.warning(
          `Row ${index + 1}: ${field} '${value}' is not ${check.label}`,
          'INVALID_CODE',
          file,
          index + 1,
          { file, id: rowId(table, row), field, value }
        );
      }
    });
  }
}

/** Passes that walk large tables are generators; the rest run in one go. */
const PASSES: [string, (c: Sweep) => Pass | void][] = [
  ['requiredFiles', requiredFiles],
  ['unknownFiles', unknownFiles],
  ['agencies', agencies],
  ['routes', routes],
  ['trips', trips],
  ['stops', stops],
  ['stopTimes', stopTimes],
  ['calendar', calendar],
  ['shapes', shapes],
  ['networks', networks],
  ['stopAreas', stopAreas],
  ['flexLocations', flexLocations],
  ['frequencies', frequencies],
  ['conditionalPresence', conditionalPresence],
  ['riderCategoryDefaults', riderCategoryDefaults],
  ['foreignKeys', foreignKeys],
  ['translations', translations],
  ['fieldWhitespace', fieldWhitespace],
  ['constrainedCodes', constrainedCodes],
  ['references', references],
];

/** The whole sweep; yields the running pass's name at each chunk boundary. */
function* sweep(
  s: FeedStore,
  extensionColumns: Record<string, string[]>
): Generator<string, ValidationResults, void> {
  const c = new Sweep(s, extensionColumns);
  const timings: string[] = [];
  for (const [name, pass] of PASSES) {
    const t0 = performance.now();
    const g = pass(c);
    while (g && !g.next().done) {
      yield name;
    }
    timings.push(`${name} ${Math.round(performance.now() - t0)}ms`);
    yield name;
  }
  console.log(`[FeedValidator] passes: ${timings.join(', ')}`);
  return {
    errors: c.errors,
    warnings: c.warnings,
    info: c.info,
    summary: {
      isValid: c.errors.length === 0,
      errorCount: c.errors.length,
      warningCount: c.warnings.length,
      infoCount: c.info.length,
    },
  };
}

/**
 * Runs sweeps step by step and keeps the last result. `revision` changes
 * with every store change; a step on a new store or revision drops the sweep
 * in progress and starts over.
 */
export class FeedValidator {
  private job: {
    store: FeedStore;
    revision: number;
    gen: Generator<string, ValidationResults, void>;
    t0: number;
  } | null = null;
  private last: {
    store: FeedStore;
    revision: number;
    results: ValidationResults;
  } | null = null;

  step(
    store: FeedStore,
    revision: number,
    extensionColumns: Record<string, string[]>
  ): ValidateStep {
    const last = this.last;
    if (last && last.store === store && last.revision === revision) {
      return { done: true, results: last.results };
    }
    if (
      !this.job ||
      this.job.store !== store ||
      this.job.revision !== revision
    ) {
      if (this.job) {
        console.log('[FeedValidator] feed changed mid-sweep, restarting');
      }
      this.job = {
        store,
        revision,
        gen: sweep(store, extensionColumns),
        t0: performance.now(),
      };
    }
    const job = this.job;
    const until = performance.now() + CONFIG.VALIDATE_STEP_MS;
    try {
      for (;;) {
        const r = job.gen.next();
        if (r.done) {
          this.job = null;
          this.last = { store, revision, results: r.value };
          console.log(
            `[FeedValidator] swept in ${Math.round(performance.now() - job.t0)}ms: ${r.value.errors.length} errors, ${r.value.warnings.length} warnings`
          );
          return { done: true, results: r.value };
        }
        if (performance.now() >= until) {
          return { done: false, pass: r.value };
        }
      }
    } catch (err) {
      this.job = null;
      throw err;
    }
  }
}
