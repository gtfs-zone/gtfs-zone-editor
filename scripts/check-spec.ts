#!/usr/bin/env tsx
/**
 * Checks the hand-written spec in src/gtfs-spec/ against the official GTFS
 * reference snapshot in reference/gtfs-reference.md, then checks every
 * Google overlay item against reference/google-reference.md (route_type codes
 * against gtfs-zone-vocab).
 *
 * Run with: pnpm check-spec
 *   pnpm check-spec agency.txt routes.txt   # restrict to some files
 *   pnpm check-spec --full                  # print the raw reference strings
 *
 * Runs in the pre-commit hook, so any drift from the reference blocks a commit.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  ROUTE_TYPE_FAMILIES,
  ROUTE_TYPES,
  routeTypeInfo,
} from 'gtfs-zone-vocab/route-types';
import { baseGtfsSpec, gtfsSpec } from '../src/gtfs-spec/index';
import { googleExtension } from '../src/gtfs-spec/extensions/google';
import type {
  GTFSEnumValue,
  GTFSFieldSpec,
  GTFSFileSpec,
  GTFSPresence,
} from '../src/gtfs-spec/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REFERENCE_PATH = join(
  __dirname,
  '..',
  'reference',
  'gtfs-reference.md'
);
const GOOGLE_REFERENCE_PATH = join(
  __dirname,
  '..',
  'reference',
  'google-reference.md'
);

// locations.geojson describes a nested JSON object rather than a CSV table, so
// its "field names" are indentation-encoded and do not map onto GTFSFieldSpec.
const STRUCTURAL_EXCEPTIONS = new Set(['locations.geojson']);

type Aspect =
  | 'file-presence'
  | 'file-description'
  | 'missing-file'
  | 'extra-file'
  | 'missing-field'
  | 'extra-field'
  | 'field-order'
  | 'type'
  | 'presence'
  | 'description'
  | 'enum-value'
  | 'note';

interface KnownDivergence {
  file: string;
  field?: string;
  aspect: Aspect;
  reason: string;
}

// Deliberate differences from the reference. Every entry needs a reason.
// This list starts empty on purpose: Phase 1 reports drift, it does not excuse it.
const KNOWN_DIVERGENCES: KnownDivergence[] = [];

// Deliberate differences between the Google overlay and google-reference.md.
const GOOGLE_KNOWN_DIVERGENCES: KnownDivergence[] = [];

// Fields whose enum values are route_type codes, checked against gtfs-zone-vocab.
const ROUTE_TYPE_FIELDS = new Set([
  'routes.txt route_type',
  'stops.txt vehicle_type',
]);

// ─── Normalization ────────────────────────────────────────────────────────────

/**
 * Collapses the incidental differences between a reference string and the same
 * string stored in a TS file: backtick markup, whitespace runs, the three <br>
 * spellings, curly quotes and non-breaking spaces. Exported so Phase 2 can
 * reuse the exact same comparison.
 */
export function normalizeSpecText(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, '<br>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/ /g, ' ')
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const PRESENCE_VALUES: GTFSPresence[] = [
  'Required',
  'Optional',
  'Conditionally Required',
  'Conditionally Forbidden',
  'Recommended',
];

/**
 * The reference bolds presence values inconsistently (`Optional` is bare in most
 * tables but bold in areas.txt), so bold markers are stripped before matching.
 */
function parsePresence(cell: string): GTFSPresence | null {
  const cleaned = cell
    .replace(/\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return PRESENCE_VALUES.find((p) => p.toLowerCase() === cleaned) ?? null;
}

// ─── Reference parsing ────────────────────────────────────────────────────────

export interface ReferenceField {
  name: string;
  type: string;
  presence: GTFSPresence | null;
  presenceRaw: string;
  description: string;
}

export interface ReferenceFile {
  filename: string;
  presence: GTFSPresence | null;
  /** Description from the "Dataset Files" summary table. */
  summaryDescription: string;
  /** Prose between the `### x.txt` heading and the field table. */
  sectionDescription: string;
  fields: Map<string, ReferenceField>;
  fieldOrder: string[];
  hasFieldTable: boolean;
}

/**
 * Splits a markdown table row. Pipes never appear in the first three columns of
 * a field table, but the description column contains an embedded HTML <table>,
 * so any surplus cells are folded back into the description.
 */
function splitRow(line: string, columns: number): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) {
    return null;
  }
  let body = trimmed.slice(1);
  if (body.endsWith('|')) {
    body = body.slice(0, -1);
  }
  const cells = body.split('|');
  if (cells.length < columns) {
    return null;
  }
  const head = cells.slice(0, columns - 1);
  const tail = cells.slice(columns - 1).join('|');
  return [...head, tail].map((c) => c.trim());
}

function isSeparatorRow(line: string): boolean {
  return /^\|[\s|:-]+\|?\s*$/.test(line.trim());
}

function stripBackticks(text: string): string {
  return text.replace(/`/g, '').trim();
}

function parseSummaryTable(
  markdown: string,
  requireSummary: boolean
): Map<string, string> {
  const result = new Map<string, string>();
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => l.trim().startsWith('## Dataset Files'));
  if (start === -1) {
    if (!requireSummary) {
      return result;
    }
    throw new Error('Could not find the "Dataset Files" section');
  }
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('## ') && i > start) {
      break;
    }
    if (isSeparatorRow(line)) {
      continue;
    }
    const cells = splitRow(line, 3);
    if (!cells) {
      continue;
    }
    const nameMatch = cells[0].match(/\[([^\]]+)\]/);
    if (!nameMatch) {
      continue;
    }
    result.set(nameMatch[1].replace(/\\/g, ''), cells[2]);
  }
  return result;
}

/**
 * Parses every `### file` section with a field table. The Google snapshot has
 * no "Dataset Files" summary, so it passes `requireSummary: false`.
 */
export function parseReference(
  markdown: string,
  requireSummary = true
): Map<string, ReferenceFile> {
  const summaries = parseSummaryTable(markdown, requireSummary);
  const lines = markdown.split('\n');
  const files = new Map<string, ReferenceFile>();

  const headingIndexes: number[] = [];
  lines.forEach((line, i) => {
    if (/^###\s+\S+\.(txt|geojson)\s*$/.test(line)) {
      headingIndexes.push(i);
    }
  });

  for (let h = 0; h < headingIndexes.length; h++) {
    const start = headingIndexes[h];
    const filename = lines[start].replace(/^###\s+/, '').trim();
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (/^##\s/.test(lines[i]) || /^###\s/.test(lines[i])) {
        end = i;
        break;
      }
    }

    const body = lines.slice(start + 1, end);
    const tableStart = body.findIndex((l) =>
      /^\|\s*Field Name\s*\|/.test(l.trim())
    );

    const proseLines: string[] = [];
    let presence: GTFSPresence | null = null;
    const proseEnd = tableStart === -1 ? body.length : tableStart;
    for (const line of body.slice(0, proseEnd)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const fileMatch = trimmed.match(/^File:\s*(.+)$/i);
      if (fileMatch) {
        presence = parsePresence(fileMatch[1]);
        continue;
      }
      if (/^primary key/i.test(trimmed)) {
        continue;
      }
      proseLines.push(trimmed);
    }

    const fields = new Map<string, ReferenceField>();
    const fieldOrder: string[] = [];
    if (tableStart !== -1) {
      for (let i = tableStart + 1; i < body.length; i++) {
        const line = body[i];
        if (!line.trim().startsWith('|')) {
          break;
        }
        if (isSeparatorRow(line)) {
          continue;
        }
        const cells = splitRow(line, 4);
        if (!cells) {
          continue;
        }
        const name = stripBackticks(cells[0]);
        if (!name) {
          continue;
        }
        fields.set(name, {
          name,
          type: cells[1],
          presence: parsePresence(cells[2]),
          presenceRaw: cells[2],
          description: cells[3],
        });
        fieldOrder.push(name);
      }
    }

    files.set(filename, {
      filename,
      presence,
      summaryDescription: summaries.get(filename) ?? '',
      // Newlines are kept so bullet lists survive into the spec files; the
      // normalizer collapses them before any comparison.
      sectionDescription: proseLines.join('\n'),
      fields,
      fieldOrder,
      hasFieldTable: tableStart !== -1,
    });
  }

  return files;
}

// ─── Word-level diff ──────────────────────────────────────────────────────────

type DiffOp = { kind: 'same' | 'del' | 'add'; word: string };

function wordDiff(expected: string, actual: string): DiffOp[] {
  const a = expected.split(' ');
  const b = actual.split(' ');
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0)
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ kind: 'same', word: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push({ kind: 'del', word: a[i] });
      i++;
    } else {
      ops.push({ kind: 'add', word: b[j] });
      j++;
    }
  }
  for (; i < a.length; i++) {
    ops.push({ kind: 'del', word: a[i] });
  }
  for (; j < b.length; j++) {
    ops.push({ kind: 'add', word: b[j] });
  }
  return ops;
}

const CONTEXT_WORDS = 5;

/** Renders a word diff as unified hunks. `-` is the reference, `+` is our spec. */
function renderDiff(
  expected: string,
  actual: string,
  indent: string
): string[] {
  const ops = wordDiff(expected, actual);
  const out: string[] = [];
  let cursor = 0;
  while (cursor < ops.length) {
    if (ops[cursor].kind === 'same') {
      cursor++;
      continue;
    }
    let changeEnd = cursor;
    while (changeEnd < ops.length) {
      if (ops[changeEnd].kind !== 'same') {
        changeEnd++;
        continue;
      }
      // A short run of matching words between two edits stays inside the hunk.
      let sameRun = 0;
      while (
        changeEnd + sameRun < ops.length &&
        ops[changeEnd + sameRun].kind === 'same'
      ) {
        sameRun++;
      }
      if (sameRun > CONTEXT_WORDS * 2) {
        break;
      }
      changeEnd += sameRun;
    }
    const before = ops
      .slice(Math.max(0, cursor - CONTEXT_WORDS), cursor)
      .map((o) => o.word)
      .join(' ');
    const after = ops
      .slice(changeEnd, changeEnd + CONTEXT_WORDS)
      .filter((o) => o.kind === 'same')
      .map((o) => o.word)
      .join(' ');
    const hunk = ops.slice(cursor, changeEnd);
    const removed = hunk
      .filter((o) => o.kind !== 'add')
      .map((o) => o.word)
      .join(' ');
    const added = hunk
      .filter((o) => o.kind !== 'del')
      .map((o) => o.word)
      .join(' ');
    const prefix = before ? `...${before} ` : '';
    const suffix = after ? ` ${after}...` : '';
    out.push(`${indent}- ${prefix}${removed}${suffix}`);
    out.push(`${indent}+ ${prefix}${added}${suffix}`);
    cursor = changeEnd;
  }
  return out;
}

// ─── Comparison ───────────────────────────────────────────────────────────────

interface Issue {
  file: string;
  field?: string;
  aspect: Aspect;
  lines: string[];
}

function isKnown(issue: Issue, known: KnownDivergence[]): boolean {
  return known.some(
    (d) =>
      d.file === issue.file &&
      d.field === issue.field &&
      d.aspect === issue.aspect
  );
}

function compare(
  reference: Map<string, ReferenceFile>,
  only: Set<string>,
  full: boolean
): Issue[] {
  const issues: Issue[] = [];
  const ourFiles = new Map(baseGtfsSpec.files.map((f) => [f.filename, f]));

  const wanted = (name: string) => only.size === 0 || only.has(name);

  for (const [filename] of reference) {
    if (!wanted(filename) || STRUCTURAL_EXCEPTIONS.has(filename)) {
      continue;
    }
    if (!ourFiles.has(filename)) {
      issues.push({
        file: filename,
        aspect: 'missing-file',
        lines: ['file is in the reference but not in baseGtfsSpec'],
      });
    }
  }

  for (const [filename] of ourFiles) {
    if (!wanted(filename) || STRUCTURAL_EXCEPTIONS.has(filename)) {
      continue;
    }
    if (!reference.has(filename)) {
      issues.push({
        file: filename,
        aspect: 'extra-file',
        lines: ['file is in baseGtfsSpec but not in the reference'],
      });
    }
  }

  for (const [filename, ref] of reference) {
    const ours = ourFiles.get(filename);
    if (!ours || !wanted(filename) || STRUCTURAL_EXCEPTIONS.has(filename)) {
      continue;
    }

    if (ref.presence && ref.presence !== ours.presence) {
      issues.push({
        file: filename,
        aspect: 'file-presence',
        lines: [
          `presence: reference "${ref.presence}", spec "${ours.presence}"`,
        ],
      });
    }

    // The reference states a file's purpose in two places: the Dataset Files
    // summary table and (for some files) prose under the section heading.
    // Either is an acceptable source for our file-level description.
    const candidates = [ref.summaryDescription, ref.sectionDescription]
      .map(normalizeSpecText)
      .filter((c) => c.length > 0);
    const oursDescription = normalizeSpecText(ours.description);
    if (candidates.length > 0 && !candidates.includes(oursDescription)) {
      const lines = [`description matches neither reference wording:`];
      for (const candidate of candidates) {
        lines.push(...renderDiff(candidate, oursDescription, '    '));
      }
      if (full) {
        lines.push(`    raw summary:  ${ref.summaryDescription}`);
        lines.push(`    raw section:  ${ref.sectionDescription}`);
      }
      issues.push({ file: filename, aspect: 'file-description', lines });
    }

    if (!ref.hasFieldTable) {
      continue;
    }

    const ourFields = new Map((ours.fields ?? []).map((f) => [f.name, f]));

    for (const name of ref.fieldOrder) {
      if (ourFields.has(name)) {
        continue;
      }
      const refField = ref.fields.get(name)!;
      issues.push({
        file: filename,
        field: name,
        aspect: 'missing-field',
        lines: [
          `missing field (${refField.type}, ${refField.presence ?? refField.presenceRaw})`,
        ],
      });
    }

    for (const name of ourFields.keys()) {
      if (ref.fields.has(name)) {
        continue;
      }
      issues.push({
        file: filename,
        field: name,
        aspect: 'extra-field',
        lines: ['field is not in the reference'],
      });
    }

    const sharedOurOrder = [...ourFields.keys()].filter((n) =>
      ref.fields.has(n)
    );
    const sharedRefOrder = ref.fieldOrder.filter((n) => ourFields.has(n));
    if (sharedOurOrder.join(',') !== sharedRefOrder.join(',')) {
      issues.push({
        file: filename,
        aspect: 'field-order',
        lines: [
          `reference order: ${sharedRefOrder.join(', ')}`,
          `spec order:      ${sharedOurOrder.join(', ')}`,
        ],
      });
    }

    for (const name of ref.fieldOrder) {
      const ourField = ourFields.get(name);
      if (ourField) {
        issues.push(
          ...compareField(filename, ref.fields.get(name)!, ourField, full)
        );
      }
    }
  }

  return issues;
}

/** Type, presence and description of one field against its reference row. */
function compareField(
  filename: string,
  refField: ReferenceField,
  ourField: GTFSFieldSpec,
  full: boolean
): Issue[] {
  const issues: Issue[] = [];
  const name = ourField.name;

  const refType = normalizeSpecText(refField.type);
  const ourType = normalizeSpecText(ourField.type);
  if (refType !== ourType) {
    issues.push({
      file: filename,
      field: name,
      aspect: 'type',
      lines: [`type: reference "${refField.type}", spec "${ourField.type}"`],
    });
  }

  if (refField.presence === null) {
    issues.push({
      file: filename,
      field: name,
      aspect: 'presence',
      lines: [`unparseable reference presence "${refField.presenceRaw}"`],
    });
  } else if (refField.presence !== ourField.presence) {
    issues.push({
      file: filename,
      field: name,
      aspect: 'presence',
      lines: [
        `presence: reference "${refField.presence}", spec "${ourField.presence}"`,
      ],
    });
  }

  const refDescription = normalizeSpecText(refField.description);
  const ourDescription = normalizeSpecText(ourField.description);
  if (refDescription !== ourDescription) {
    const lines = ['description mismatch:'];
    lines.push(...renderDiff(refDescription, ourDescription, '    '));
    if (full) {
      lines.push(`    raw reference: ${refField.description}`);
    }
    issues.push({
      file: filename,
      field: name,
      aspect: 'description',
      lines,
    });
  }

  return issues;
}

// ─── Google overlay ───────────────────────────────────────────────────────────

interface GoogleReference {
  /** `### file` sections under "Extensions". */
  extensions: Map<string, ReferenceFile>;
  unsupportedFiles: Set<string>;
  unsupportedText: string;
  /** Keyed by "file field". */
  ignoredFields: Set<string>;
  ignoredText: string;
  /** "Different interpretation" rows, keyed by "file field". */
  interpretations: Map<string, ReferenceField>;
}

/** Prose and table rows (raw cells) of a flat `## heading` section. */
function parseFlatSection(
  markdown: string,
  heading: string,
  columns: number
): { text: string; rows: string[][] } {
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start === -1) {
    throw new Error(`Could not find the "${heading}" section`);
  }
  const prose: string[] = [];
  const rows: string[][] = [];
  let header = true;
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) {
      break;
    }
    const trimmed = line.trim();
    if (!trimmed || isSeparatorRow(trimmed)) {
      continue;
    }
    const cells = splitRow(trimmed, columns);
    if (!cells) {
      prose.push(trimmed);
    } else if (header) {
      header = false;
    } else {
      rows.push(cells);
    }
  }
  return { text: prose.join(' '), rows };
}

function parseGoogleReference(markdown: string): GoogleReference {
  const unsupported = parseFlatSection(markdown, 'Unsupported files', 1);
  const ignored = parseFlatSection(markdown, 'Ignored fields', 3);
  const different = parseFlatSection(markdown, 'Different interpretation', 5);
  const interpretations = new Map<string, ReferenceField>();
  for (const [file, field, type, presence, description] of different.rows) {
    const name = stripBackticks(field);
    interpretations.set(`${stripBackticks(file)} ${name}`, {
      name,
      type,
      presence: parsePresence(presence),
      presenceRaw: presence,
      description,
    });
  }
  return {
    extensions: parseReference(markdown, false),
    unsupportedFiles: new Set(unsupported.rows.map(([f]) => stripBackticks(f))),
    unsupportedText: unsupported.text,
    ignoredFields: new Set(
      ignored.rows.map(([f, n]) => `${stripBackticks(f)} ${stripBackticks(n)}`)
    ),
    ignoredText: ignored.text,
    interpretations,
  };
}

/** Values a Google description lists as `- **`N`.** ...` items. */
function listedEnumValues(description: string): string[] {
  return [...description.matchAll(/- \*\*`([^`]+)`\.\*\*/g)].map((m) => m[1]);
}

const FAMILY_LABELS = new Map(
  ROUTE_TYPE_FAMILIES.map((f) => [f.slug, f.label.en])
);

/** A route_type code against its gtfs-zone-vocab entry. */
function checkRouteTypeValue(value: GTFSEnumValue): string | null {
  const info = routeTypeInfo(Number(value.value));
  if (!info) {
    return `${value.value}: not in gtfs-zone-vocab`;
  }
  const fromGoogle = value.origin === googleExtension.id;
  if (fromGoogle !== (info.source === 'google-hvt')) {
    return `${value.value}: origin "${value.origin ?? 'base'}" but vocab source "${info.source}"`;
  }
  if (value.label !== info.label.en) {
    return `${value.value}: label "${value.label}", vocab "${info.label.en}"`;
  }
  const family = FAMILY_LABELS.get(info.family);
  if (value.group !== undefined && value.group !== family) {
    return `${value.value}: group "${value.group}", vocab family "${family}"`;
  }
  return null;
}

function checkEnumValue(
  google: GoogleReference,
  filename: string,
  field: GTFSFieldSpec,
  value: GTFSEnumValue
): string | null {
  const key = `${filename} ${field.name}`;
  if (ROUTE_TYPE_FIELDS.has(key)) {
    return checkRouteTypeValue(value);
  }
  const row =
    google.extensions.get(filename)?.fields.get(field.name) ??
    google.interpretations.get(key);
  if (!row) {
    return `${value.value}: no Google row describes ${field.name}`;
  }
  const listed = listedEnumValues(row.description);
  if (listed.length === 0) {
    return `${value.value}: the Google row lists no values`;
  }
  if (!listed.includes(String(value.value))) {
    return `${value.value}: not among the listed values ${listed.join(', ')}`;
  }
  return null;
}

function checkNote(
  google: GoogleReference,
  filename: string,
  field: string | undefined,
  text: string
): string | null {
  const ours = normalizeSpecText(text);
  if (field === undefined) {
    if (!google.unsupportedFiles.has(filename)) {
      return 'file note, but the file is not under "Unsupported files"';
    }
    return ours === normalizeSpecText(google.unsupportedText)
      ? null
      : 'note text differs from the "Unsupported files" prose';
  }
  const key = `${filename} ${field}`;
  const interpretation = google.interpretations.get(key);
  if (interpretation) {
    return ours === normalizeSpecText(interpretation.description)
      ? null
      : 'note text differs from the "Different interpretation" row';
  }
  if (google.ignoredFields.has(key)) {
    return ours === normalizeSpecText(google.ignoredText)
      ? null
      : 'note text differs from the "Ignored fields" prose';
  }
  return 'no "Ignored fields" or "Different interpretation" row';
}

/** Every Google-origin file, field, enum value and note against the snapshot. */
function compareGoogle(
  google: GoogleReference,
  only: Set<string>,
  full: boolean
): Issue[] {
  const issues: Issue[] = [];
  const origin = googleExtension.id;
  const wanted = (name: string) => only.size === 0 || only.has(name);

  for (const file of gtfsSpec.files) {
    const filename = file.filename;
    if (!wanted(filename)) {
      continue;
    }
    const ref = google.extensions.get(filename);
    const overlayFile = file.origin === origin;

    if (overlayFile && !ref) {
      issues.push({
        file: filename,
        aspect: 'extra-file',
        lines: ['overlay file is not in the Google snapshot'],
      });
    }
    if (overlayFile && ref) {
      const ours = new Set((file.fields ?? []).map((f) => f.name));
      for (const name of ref.fieldOrder) {
        if (!ours.has(name)) {
          issues.push({
            file: filename,
            field: name,
            aspect: 'missing-field',
            lines: [
              'field is in the Google snapshot but not in the overlay file',
            ],
          });
        }
      }
    }

    for (const field of file.fields ?? []) {
      // Fields of an overlay file carry no origin of their own.
      const overlayField = overlayFile || field.origin === origin;
      if (overlayField && (ref || !overlayFile)) {
        const refField = ref?.fields.get(field.name);
        if (refField) {
          issues.push(...compareField(filename, refField, field, full));
        } else {
          issues.push({
            file: filename,
            field: field.name,
            aspect: 'extra-field',
            lines: ['overlay field is not in the Google snapshot'],
          });
        }
      }

      const values = (field.enumValues ?? []).filter(
        (v) => overlayField || v.origin === origin
      );
      for (const value of values) {
        const problem = checkEnumValue(google, filename, field, value);
        if (problem) {
          issues.push({
            file: filename,
            field: field.name,
            aspect: 'enum-value',
            lines: [problem],
          });
        }
      }

      for (const note of field.notes ?? []) {
        const problem =
          note.origin === origin &&
          checkNote(google, filename, field.name, note.text);
        if (problem) {
          issues.push({
            file: filename,
            field: field.name,
            aspect: 'note',
            lines: [problem],
          });
        }
      }
    }

    for (const note of file.notes ?? []) {
      const problem =
        note.origin === origin &&
        checkNote(google, filename, undefined, note.text);
      if (problem) {
        issues.push({ file: filename, aspect: 'note', lines: [problem] });
      }
    }
  }

  return issues;
}

/** Snapshot rows the overlay does not carry yet. Reported, never fatal. */
function googleCoverage(google: GoogleReference): string[] {
  const origin = googleExtension.id;
  const files = new Map(gtfsSpec.files.map((f) => [f.filename, f]));
  const findField = (file: string, name: string) =>
    files.get(file)?.fields?.find((f) => f.name === name);
  const hasNote = (notes: GTFSFileSpec['notes']) =>
    (notes ?? []).some((n) => n.origin === origin);
  const missing: string[] = [];

  for (const [filename, ref] of google.extensions) {
    for (const name of ref.fieldOrder) {
      const ours = findField(filename, name);
      if (filename === 'routes.txt' && name === 'route_type') {
        const codes = new Set(ours?.enumValues?.map((v) => v.value));
        const absent = ROUTE_TYPES.filter(
          (rt) => rt.source === 'google-hvt' && !codes.has(rt.code)
        );
        if (absent.length > 0) {
          missing.push(
            `${filename} ${name}: ${absent.length} google-hvt codes`
          );
        }
        continue;
      }
      const covered =
        ours &&
        (ours.origin === origin || files.get(filename)?.origin === origin);
      if (!covered) {
        missing.push(`${filename} ${name}`);
      }
    }
  }
  for (const key of [
    ...google.ignoredFields,
    ...google.interpretations.keys(),
  ]) {
    const [filename, name] = key.split(' ');
    if (!hasNote(findField(filename, name)?.notes)) {
      missing.push(`${key} (note)`);
    }
  }
  for (const filename of google.unsupportedFiles) {
    if (!hasNote(files.get(filename)?.notes)) {
      missing.push(`${filename} (note)`);
    }
  }
  return missing;
}

// ─── Entry point ──────────────────────────────────────────────────────────────

/** Prints issues grouped by file and returns the per-aspect counts. */
function printIssues(issues: Issue[]): Map<Aspect, number> {
  const byFile = new Map<string, Issue[]>();
  for (const issue of issues) {
    const list = byFile.get(issue.file) ?? [];
    list.push(issue);
    byFile.set(issue.file, list);
  }

  const counts = new Map<Aspect, number>();
  for (const [filename, fileIssues] of byFile) {
    console.log(`=== ${filename} ===`);
    for (const issue of fileIssues) {
      counts.set(issue.aspect, (counts.get(issue.aspect) ?? 0) + 1);
      const label = issue.field ? `${issue.field}: ` : '';
      console.log(`  [${issue.aspect}] ${label}${issue.lines[0]}`);
      for (const line of issue.lines.slice(1)) {
        console.log(line);
      }
    }
    console.log('');
  }
  return counts;
}

function printSummary(
  title: string,
  issues: Issue[],
  counts: Map<Aspect, number>,
  excused: number
): void {
  console.log(`--- ${title} ---`);
  for (const aspect of [...counts.keys()].sort()) {
    console.log(`  ${aspect}: ${counts.get(aspect)}`);
  }
  console.log(`  files with drift: ${new Set(issues.map((i) => i.file)).size}`);
  console.log(`  total differences: ${issues.length}`);
  if (excused > 0) {
    console.log(`  excused by known divergences: ${excused}`);
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const full = args.includes('--full');
  const only = new Set(args.filter((a) => !a.startsWith('--')));

  const reference = parseReference(readFileSync(REFERENCE_PATH, 'utf8'));
  const all = compare(reference, only, full);
  const issues = all.filter((issue) => !isKnown(issue, KNOWN_DIVERGENCES));

  console.log(`Reference: ${REFERENCE_PATH}`);
  console.log(
    `Parsed ${reference.size} files from the reference, ${baseGtfsSpec.files.length} from baseGtfsSpec (${baseGtfsSpec.specVersion}).`
  );
  console.log(
    `Skipped by filename: ${[...STRUCTURAL_EXCEPTIONS].join(', ')} (no CSV field table).`
  );
  console.log('');
  const counts = printIssues(issues);

  const google = parseGoogleReference(
    readFileSync(GOOGLE_REFERENCE_PATH, 'utf8')
  );
  const googleAll = compareGoogle(google, only, full);
  const googleIssues = googleAll.filter(
    (issue) => !isKnown(issue, GOOGLE_KNOWN_DIVERGENCES)
  );

  console.log(`Google snapshot: ${GOOGLE_REFERENCE_PATH}`);
  console.log(
    `Parsed ${google.extensions.size} extension files, ${google.ignoredFields.size} ignored fields, ${google.interpretations.size} interpretation rows, ${google.unsupportedFiles.size} unsupported files.`
  );
  console.log('');
  const googleCounts = printIssues(googleIssues);

  printSummary('reference', issues, counts, all.length - issues.length);
  printSummary(
    'Google overlay',
    googleIssues,
    googleCounts,
    googleAll.length - googleIssues.length
  );
  if (only.size === 0) {
    const missing = googleCoverage(google);
    console.log(`  snapshot rows not in the overlay yet: ${missing.length}`);
    if (full) {
      for (const line of missing) {
        console.log(`    ${line}`);
      }
    }
  }

  if (issues.length > 0 || googleIssues.length > 0) {
    process.exitCode = 1;
  }
}

// Guarded so other scripts can import the reference parser without running the check.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
