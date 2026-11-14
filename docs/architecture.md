# Architecture

How the editor is put together, and the invariants that keep it correct.
`AGENTS.md` links here for each rule.

## Module groups

All modules live in `src/modules/` and are instantiated and wired together by
`GTFSEditor` in `src/index.ts`, via constructor injection and callbacks (no DI
framework). Circular references are resolved post-construction by passing
references explicitly.

| Group | Modules |
|-------|---------|
| Feed | `src/feed/`: `editor-feed.ts` (main-thread client), `feed-worker-api.ts` (store worker, patch log), `feed-loader.ts`, `patch-build.ts`, `patch-apply.ts`, `route-refs.ts` |
| Data | `gtfs-validator.ts`, `zone-store.ts` |
| Map | `map-controller.ts`, `route-renderer.ts`, `layer-manager.ts`, `interaction-handler.ts` |
| Editor | `editor.ts` (Files table viewer, Clusterize grid), `ui.ts` (file list / editor / preview state machine), `history-controller.ts` (Changes panel UI) |
| Navigation | `page-state-manager.ts`, `breadcrumbs.ts`, `objects-navigation.ts`, `page-content-renderer.ts` |
| Views | `schedule-controller.ts`, `service-days-controller.ts`, `stop-view-controller.ts`, `timetable-*.ts` |
| UI | `navbar-action-list.ts`, `shortcut-list.ts`, `help-pages.ts`, `tab-lock.ts` |

## State model

There is no centralized state management (no Redux/Zustand). State is distributed:

- **Feed worker** (`EditorFeed`): the feed's columnar store and patch log;
  the base is an OPFS file, the log and its state live in IndexedDB
- **`PageStateManager`**: URL hash-based navigation state
- **Module-level state**: each controller owns its own state
- **DOM state**: tab selection, active view

## Patch system

Every user edit is a patch: build ops with `insertOp` / `updateOp` /
`deleteOp` from `src/feed/patch-build.ts` and send them with
`EditorFeed.apply` (or `edit` for a built patch). The worker applies the patch
to the store and logs it before the call resolves; nothing writes rows any
other way. Non-table entries (passthrough files, `locations.geojson`) are
patched whole with `EditorFeed.editFile`, or as `files` on `apply` to batch
them with row ops.

## Frozen rows

Mirror rows (`EditorFeed.table`, `byKey`) are frozen when they reach the
mirror, and a change replaces the row object instead of mutating it. A row
held across an edit keeps its old values; writing to one throws. Copy a row
(or the array) before handing it to anything that mutates it. Rows read from
the worker (`find`, `where`, `byKeys`, `read`) are copies already.

Values are strings, exactly as in the file; parse numbers where they are
used. An absent value is `''`, so test with `||`, not `??`.

## Networks

GTFS allows two mutually exclusive on-disk forms, `routes.network_id` or the
two network files. In the store it is always the two tables, `networks` +
`route_networks`: import synthesizes them from `routes.network_id` when that is
the form the feed used, and nothing reads `routes.network_id` afterwards. Which
form the feed arrived in is remembered as `networksMode` in the feed state
and decides the export form, unless a network has gained a name (which forces
the files form). Never write `routes.network_id` outside export.

## Spec overlays

`baseGtfsSpec` in `src/gtfs-spec/index.ts` is the MobilityData spec, verbatim.
Additions from other sources are overlays (`GTFSSpecExtension` in
`src/gtfs-spec/extensions/types.ts`): files, fields (placed with `after`),
enum values and behavior notes. `applyExtensions` layers them onto a copy of
the base and stamps `origin` (e.g. `'google'`) on each item it adds; it throws
when an overlay targets a missing file or field or re-adds an existing name or
value. The result, `gtfsSpec`, is what the adapter and the rest of the app
read, so overlay fields and values are known: they get typed specs, enum
options and Zod schemas like base ones. Every field an overlay adds to a base
file is Optional, so its schema entry is optional and a feed without the
column still parses.

A field an overlay adds to a base file shows only when the rows carry the
column or the user added it (`specFieldShown` in
`src/utils/extension-fields.ts`, the same rule as extension fields); the Add
field dialog offers the hidden ones by name. Labels carry the overlay's badge
and link to its reference, and overlay notes render under the description in
field tooltips and, for file notes, in the Files view (`src/utils/spec-origin.ts`).

Fields of an overlay file carry no `origin` of their own; the file's `origin`
marks them. Enum values inside an overlay field likewise carry `origin` only
when set by hand, so base route types in `stops.txt` `vehicle_type` stay
unmarked.

Never put an overlay item in `src/gtfs-spec/files/*.ts`. `pnpm check-spec`
checks the base against `reference/gtfs-reference.md` and every
`origin: 'google'` item against `reference/google-reference.md`; see
[reference/README.md](../reference/README.md).

## Extension fields

Extension fields are unknown columns: neither the base spec nor an overlay
names them. (A column an overlay names is a known extension and has a real
spec; see [Spec overlays](#spec-overlays).) An unknown column of a CSV table
exists because rows carry that key, so
`extensionFields(tableName, rows)` in `src/utils/extension-fields.ts` is the
only source of the list, and `extensionFieldSpec` supplies the synthetic
optional-text spec every renderer needs. Both shared field renderers
(`editable-table.ts`'s `columnFields`, `inline-editable-field.ts`'s
`renderInlineEntityFields`) append them after the spec fields that show.

The one thing data-derivation cannot express, a column the user just created
with no values yet, lives in the feed state under `extensionColumns`. Never
add extension fields to the Zod schemas: those are generated from
`src/gtfs-spec/` and `pnpm check-spec` blocks the divergence.

## IndexedDB requests

No IndexedDB request may be waited on without a way out. An open or delete
queued behind a blocked version-change operation fires no event at all, not
success, not error, not even `blocked`, so a bare `await` on one hangs forever
with nothing logged. Everything on the boot path goes through the helpers in
`src/utils/idb-request.ts`.

A blocked delete is not a completed delete: reporting it as success and
reloading leaves the request queued and wedges every later request on that
database, including the next page load's version probe.

The other half of the rule is never to be the blocker: the open connection
carries a `blocking` handler that closes it when another tab needs an upgrade.

## Yielding on long jobs

Never yield with `setTimeout` on a long job: a hidden tab clamps timers to
about one second, so a pass that yields per step turns into a hang that looks
like a wedged database. Measured in Firefox with the tab hidden: ten
`setTimeout(0)` round trips took 10059ms, ten MessageChannel round trips took
1ms. `yieldToEventLoop` in `src/utils/async-yield.ts` is the only yield
primitive, it posts on a shared MessageChannel, and it stays a macrotask so the
progress bar still paints.

## Feed-scoped caches

Every module is constructed and can read feed data before a feed exists, so a
cache guarded only by `if (this.cache)` or `=== null` pins the empty boot
scaffold for the whole session. Feed-scoped caches key on `feedGeneration` or
subscribe to `onFeedReplaced`.

`EditorFeed.adopt` is the single emit point and fires once the new feed is
open, its log replayed. Use the pull side (`feed.feedGeneration` as part of
the memo key) for anything recomputable synchronously; use `onFeedReplaced`
only when the invalidation needs imperative or async work.
