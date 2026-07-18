# Task 5 Report

## Status

Implemented and verified.

## Scope

- Added independent wishlist, watching, and held collection synchronization.
- Added season-window classification, safe display totals, valid air-year mapping, and wishlist episode skipping.
- Preserved local completed rows and avoided all remote collection-status writes during sync.
- Added the repository/planner adapter for locked-today preservation, planner overrides, seven-date seasonal load, future replacement, and cursor persistence.
- Kept `syncWatchingAnime` as a compatibility wrapper until Task 6 migrates the existing dashboard caller.

## TDD Evidence

### Red

Command:

```sh
npm test -- tests/server/sync.test.ts tests/server/sync-integration.test.ts
```

Result before implementation:

```text
Test Files  2 failed (2)
Tests       8 failed (8)
TypeError: syncAnimeCollections is not a function
TypeError: rebuildBacklogPlan is not a function
```

The first full-suite run also exposed the expected legacy-caller regression after a direct alias replaced `syncWatchingAnime`:

```text
Test Files  2 failed | 12 passed (14)
Tests       4 failed | 98 passed (102)
TypeError: client.getAnimeCollections is not a function
```

This was fixed with a narrow watching-only compatibility wrapper; no dashboard or OAuth files changed.

### Green

Command:

```sh
npm test -- tests/server/sync.test.ts tests/server/sync-integration.test.ts tests/server/backlog-planner.test.ts tests/server/db.test.ts
```

Result:

```text
Test Files  4 passed (4)
Tests       37 passed (37)
```

`npx tsc -p tsconfig.server.json --noEmit` and owned-file ESLint checks exited `0`.

### Full Verification

```sh
npm test
npm run lint
npm run build
git diff --check
```

Results:

```text
Test Files  14 passed (14)
Tests       102 passed (102)
ESLint      exit 0
Build       exit 0
Diff check  exit 0
```

## Commit

- `feat: sync and classify anime collections`

## Concerns

- The concrete client currently exposes only `getBroadcastTimes`; `getBroadcastCatalog` remains optional and is not implemented in `src/server/bangumi-client.ts`. The new sync has a compatibility fallback, but production seasonal classification requires that existing dependency to expose the full catalog before Task 6 switches the dashboard caller.
- Concurrent commit `d5155e7` updated `src/server/broadcast-schedule.ts` and its test while this task was in progress. Those changes were left untouched and are not part of the Task 5 diff.
