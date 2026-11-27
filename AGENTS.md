# AGENTS.md

**GTFS.zone** is a browser-based GTFS transit data editor, inspired by geojson.io.
It is a client-only SPA: no backend, all data stays in the browser (OPFS and IndexedDB).

## Commands

```bash
pnpm check        # typecheck + lint + knip
pnpm vuln         # osv-scanner vulnerability gate
```

## Architecture

`GTFSEditor` in `src/index.ts` instantiates every module in `src/modules/` and wires them together via constructor injection and callbacks (no DI framework). There is no central store: GTFS data lives in the feed worker (`EditorFeed` in `src/feed/`), navigation in the URL hash (`PageStateManager`), and everything else in the controller that owns it. Module groups and the state model are in [docs/architecture.md](docs/architecture.md).

App-wide tunables live in `CONFIG` in `src/config.ts`. GTFS types and their Zod schemas are in `src/types/`; use Zod for any new field validation.

### Shared modules (`gtfs-zone-web-common`)

Modules shared with the two realtime apps live in the `gtfs-zone-web-common` package, a git dependency shipping raw TypeScript with no build step. Import them as `gtfs-zone-web-common/ui/...`, `gtfs-zone-web-common/gtfs/...`, `gtfs-zone-web-common/map/...` and `gtfs-zone-web-common/util/...`; `tsconfig.json` `paths` point at `node_modules/gtfs-zone-web-common/src`, and the `resolve.alias` in `vite.config.js` at that path's real location, so the app's imports and web-common's relative ones share one module URL. It includes the app shell (mounted by `src/shell.ts`, which `index.ts` must import first) and its stylesheet.

A shared change is a commit in gtfs-zone-web-common, a tag, and a bump in each consumer. It is not edited here.

The dev server restarts itself when `pnpm-lock.yaml` changes (`restartOnLockfile` in `vite.config.js`). The alias resolves through a pnpm symlink into the store, and Vite does not watch `node_modules`, so without a restart files whose transform is still cached (the shared stylesheet's `@import` included) keep importing the old store path: the page then holds two copies of a shared module, each with its own module-level state. gtfs-zone-web-common's `util/module-state` keeps that from corrupting anything and logs `loaded twice`.

### Spec layer

The spec layer lives in web-common (`gtfs-zone-web-common/gtfs/spec/`): `files/*.ts` mirror its verbatim snapshot of the official GTFS Schedule reference, each with its `primaryKey`, and `adapter.ts` derives the Zod schemas, enums and field types from there. `primary-keys.ts` is the one row-key list (`GTFS_PRIMARY_KEYS`, `getGTFSPrimaryKey`); `src/utils/gtfs-primary-keys.ts` only builds the editor's key strings over it. Google additions sit on top as an overlay (`extensions/google.ts`); `gtfsSpec` is the base plus the overlay, `baseGtfsSpec` the verbatim spec. Web-common's `pnpm check-spec` blocks any drift from the reference. Descriptions carry markdown and HTML, so render them through `renderSpecDescription` / `renderSpecDescriptionPlain` in `gtfs-zone-web-common/gtfs/spec-markup`. Refreshing the snapshot is covered in web-common's `reference/README.md`.

## Development philosophy

- **Reliability over performance**: correctness and predictability come first. Optimize only when a measured bottleneck warrants it.
- **Simplicity over abstraction**: three similar lines of code are better than a premature abstraction.
- **No backwards-compatibility hacks**: users can reset the database (Settings -> Reset) rather than us shipping migration shims.
- **Logging for debuggability**: `console.log` / `console.warn` at key state transitions (patch recording, DB writes, navigation), with a `[ModuleName]` prefix.
- **Fail loudly**: prefer throwing or logging errors over silent fallbacks.

Invariants (details in [docs/architecture.md](docs/architecture.md)):

- [Every user edit goes through the patch system](docs/architecture.md#patch-system).
- [Mirror rows are frozen](docs/architecture.md#frozen-rows); copy before mutating.
- [Networks are canonical as `networks` + `route_networks`](docs/architecture.md#networks); never write `routes.network_id` outside export.
- [Spec additions go in an overlay](docs/architecture.md#spec-overlays), never in web-common's `gtfs/spec/files/*.ts`.
- [Extension fields are derived from row data](docs/architecture.md#extension-fields), never hardcoded or added to the Zod schemas.
- [No IndexedDB request is awaited without a timeout](docs/architecture.md#indexeddb-requests), and no connection blocks another tab's upgrade.
- [Never yield with `setTimeout` on a long job](docs/architecture.md#yielding-on-long-jobs); use `yieldToEventLoop`.
- [Feed-scoped caches key on `feedGeneration` or subscribe to `onFeedReplaced`](docs/architecture.md#feed-scoped-caches).

## Conventions

- **Commits**: Conventional Commits, enforced by commitizen in the `commit-msg` hook. `pnpm commit` helps build one; plain `git commit` works too.
- **TypeScript**: strict mode, with `noUnusedLocals` and `noUnusedParameters`. Remove unused code rather than suppressing.
- **CSS**: Tailwind CSS v4 + DaisyUI v5, configured in `src/styles/main.css` (no `tailwind.config.js`). The `@source` pointing into `node_modules/gtfs-zone-web-common/src` is what styles the shared modules. Write styles with Tailwind utility classes.
- **UI**: conventions live in gtfs-zone-web-common's `AGENTS.md`.
- **Copy**: UI strings live in `src/i18n/en/*.ts` (the source of the keys) and the matching `src/i18n/fr/*.ts` and `src/i18n/de/*.ts`, read through `t()` from `src/i18n/messages.ts`. A new string goes in all three. GTFS field names, file names and enum values stay literal inside messages.

<!-- shared:start -->
## Shared conventions

Synced from `docs/agents-shared.md` in
[gtfs-zone/.github](https://github.com/gtfs-zone/.github). Edit it there, then
run `mani run sync-agents`; CI fails while this block differs from that copy.

- **Pull requests**: every change to `main` goes through a PR
  ([ADR 0005](https://github.com/gtfs-zone/.github/blob/main/docs/adr/0005-pr-flow.md)).
  Branch from `main` (never an `agent/` prefix), push, open it with
  `gh pr create`. The description lists the changes made, nothing else.
  Merge with a merge commit once the required checks and Argos (where
  present) pass. Renovate PRs follow the same flow. Never push to `main`.
- **Commits**: Conventional Commits on every commit. Never add
  Co-Authored-By trailers.
- **Plans**: `CURRENT_PLAN.md` at the repo root follows the
  [plan standard](https://github.com/gtfs-zone/.github/blob/main/docs/plan-standard.md).
  It is neither tracked nor gitignored: never stage or commit it.
  Decisions go in ADRs: cross-repo ones in
  [gtfs-zone/.github `docs/adr/`](https://github.com/gtfs-zone/.github/tree/main/docs/adr),
  single-repo ones in the repo's own `docs/adr/`.
- **Testing**
  ([ADR 0007](https://github.com/gtfs-zone/.github/blob/main/docs/adr/0007-testing-policy.md)):
  Vitest for pure logic and invariants (`pnpm test`, part of `pnpm check`),
  Playwright with Argos for UI, both on web-common's presets. Python repos
  use pytest. A test file says which invariant it holds and links where
  that invariant is documented.
- **Local web-common**: in a consumer, `pnpm common:local` links
  `../gtfs-zone-web-common` in place of the pinned tag, so its edits show up
  live; `pnpm common:tag` restores the tag. Build and push fail while the
  link is local. The change itself still lands in web-common as a PR, a tag
  and a bump in each consumer.
- **Tooling**: mise pins each repo's toolchain (`.mise.toml`, then
  `mise install`). mani runs tasks across every repo from
  gtfs-zone-dev-stack (`mani run status`, `mani run sync-agents`). Sibling
  repos live under one parent directory and may be read and edited when a
  change spans repos.
<!-- shared:end -->
