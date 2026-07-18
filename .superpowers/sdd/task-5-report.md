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

## Authoritative Season Window Safety Follow-up

Generic collection sync now requires `getBroadcastCatalog` to return a non-empty authoritative season window before collection reads begin. Missing or empty authority throws a clear internal error and leaves existing subject classification, episodes, and backlog tasks unchanged. The legacy `syncWatchingAnime` wrapper retains its existing broadcast-times fallback.

### Red

```sh
npm test -- tests/server/sync-integration.test.ts
```

```text
Test Files  1 failed (1)
Tests       2 failed | 4 passed (6)
AssertionError: promise resolved "{ subjectsSynced: 3, episodesSynced: 2 }" instead of rejecting
```

### Green

```sh
npm test -- tests/server/sync.test.ts tests/server/sync-integration.test.ts tests/server/bangumi-client.test.ts tests/server/backlog-planner.test.ts tests/server/db.test.ts
npx tsc -p tsconfig.server.json --noEmit
npx eslint src/server/sync.ts tests/server/sync.test.ts tests/server/sync-integration.test.ts
```

```text
Test Files  5 passed (5)
Tests       53 passed (53)
TypeScript  exit 0
ESLint      exit 0
```

### Concurrent Full Suite

```sh
npm test
npm run lint
npm run build
```

```text
Test Files  2 failed | 12 passed (14)
Tests       7 failed | 134 passed (141)
Full ESLint exit 0
Build       exit 0
```

The seven full-suite failures are in concurrently edited Task 6 dashboard/OAuth tests whose client fixtures omit `getBroadcastCatalog` or return an empty window. Task 5's focused suites are green; no Task 6 files were changed by this fix.

## Commit

- `feat: sync and classify anime collections`

## Concerns

- None.

## Coordination

- Concurrent commit `d5155e7` updated `src/server/broadcast-schedule.ts` and its test while this task was in progress. Those changes were left untouched and are not part of the Task 5 diff.

## Production Catalog Wiring Follow-up

Added concrete `createBangumiClient().getBroadcastCatalog()` wiring to the existing `fetchBroadcastCatalog` function using the factory's existing fetch implementation and user agent. Existing `getBroadcastTimes` and calendar paths are unchanged.

### Red

```sh
npm test -- tests/server/bangumi-client.test.ts
```

```text
Test Files  1 failed (1)
Tests       1 failed | 13 passed (14)
AssertionError: expected undefined to be type of 'function'
```

### Green

```sh
npm test -- tests/server/bangumi-client.test.ts tests/server/sync-integration.test.ts
```

```text
Test Files  2 passed (2)
Tests       18 passed (18)
```

### Full Verification

```sh
npm test
npm run build
npm run lint
git diff --check
```

```text
Test Files  14 passed (14)
Tests       103 passed (103)
Build       exit 0
ESLint      exit 0
Diff check  exit 0
```
