# GTFS reference snapshots

`gtfs-reference.md` is a verbatim copy of the official GTFS Schedule reference.
`google-reference.md` is a snapshot of Google's differences from it (see
[Google snapshot](#google-snapshot)).

- Source: https://raw.githubusercontent.com/google/transit/master/gtfs/spec/en/reference.md
- Revision: **April 27, 2026**
- License: Apache-2.0, Copyright Google Inc. and contributors (maintained by
  MobilityData). The same applies to `src/gtfs-spec/files/` and the diagrams in
  `src/assets/gtfs-spec/`; see `REUSE.toml`.

It is the single source of truth for every file name, field name, type string,
presence value, and description in `src/gtfs-spec/`. `pnpm check-spec` diffs the
two and fails on any difference that is not listed in the script's
`KNOWN_DIVERGENCES`. It checks `baseGtfsSpec`, the spec without the overlay.
It runs from `pnpm check` in the pre-commit hook, so drift blocks a commit.

## Refreshing the snapshot

1. Re-download the file over `reference/gtfs-reference.md` and update the
   revision date above and `specVersion` in `src/gtfs-spec/index.ts`.
2. Run `pnpm check-spec` to get the full drift report. `pnpm check-spec <file>`
   restricts it to named files; `--full` also prints the raw reference strings,
   which is what goes into the spec files.
3. Fix each difference in `src/gtfs-spec/files/*.ts` until the checker exits
   zero. Descriptions and type strings are stored verbatim; the curated extras
   (enum short labels, `foreignKey`, `isPrimaryKey`, `presenceCondition`,
   `allowEmpty`) are hand-written and are not checked.
4. New or renamed fields also need a look at `src/utils/gtfs-primary-keys.ts`,
   `src/types/gtfs-field-types.ts` (a new type string needs a `GTFSFieldType`
   member and a formatter), and any images the new descriptions embed, which are
   vendored into `src/assets/gtfs-spec/`.

## Google snapshot

`google-reference.md` holds the four tables of Google's "differences from the
official GTFS" page, reformatted as markdown so the check-spec parser reads it.

- Source: https://developers.google.com/transit/gtfs/reference
- Revision: **Last updated 2025-05-15 UTC** (fetched 2026-11-05)
- License: CC-BY-4.0, Copyright Google LLC. The same applies to the wording in
  `src/gtfs-spec/extensions/google.ts`; see `REUSE.toml`.

Its layout:

- `## Unsupported files` (Table 1) and `## Ignored fields` (Table 2), each with
  the page's one-line definition of "ignored" as prose. A note on one of these
  files or fields carries that sentence.
- `## Different interpretation` (Table 3), one row per field, with Google's
  implementation details as the description. A note on one of these fields
  carries that description.
- `## Extensions` (Table 4), one `### file` section per file with a
  `gtfs-reference.md`-style field table, rows in page order. The
  `routes.txt` `route_type` row stands for the extended route types, whose
  codes live in `gtfs-zone-vocab`.

Cell text is the page's text. Only the markup is converted: `<code>` to
backticks, `<a>` to markdown links, `<strong>`/`<em>` to `**`/`*`, paragraphs
joined with `<br><br>` and list items with `<br>- `, as in `gtfs-reference.md`.

`pnpm check-spec` runs a second pass over every item the overlay
(`src/gtfs-spec/extensions/google.ts`) adds, which `applyExtensions` stamps
with `origin: 'google'`:

- fields (and every field of an overlay file): type, presence and description
  against the Extensions row
- enum values: route_type codes (`routes.txt` `route_type`, `stops.txt`
  `vehicle_type`) against `gtfs-zone-vocab` (label, family as `group`, and
  `origin` matching the vocab source); any other value must appear in the
  row's `- **`N`.**` list
- notes: text against the Ignored, Unsupported or Different interpretation
  wording

Deliberate differences go in `GOOGLE_KNOWN_DIVERGENCES`, each with a reason.
Snapshot rows the overlay does not carry yet are counted in the summary
(`--full` lists them) but do not fail the check.

### Refreshing the Google snapshot

1. Open the source page and compare its "Last updated" date with the revision
   above. If it is unchanged, stop.
2. Edit `google-reference.md` by hand to match each table: add, drop or
   reword rows, converting the markup as described above. Update the header
   comment, the revision above and `revision` in
   `src/gtfs-spec/extensions/google.ts`.
3. Run `pnpm check-spec` and fix the overlay until it exits zero. New
   extended route types come in through a `gtfs-zone-vocab` bump instead.
