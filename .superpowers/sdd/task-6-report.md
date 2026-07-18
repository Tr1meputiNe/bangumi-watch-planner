# Task 6 Report

## Status

Implemented and verified. One deferred repository-wide test concern is documented below.

## Scope

- Added backlog and wishlist read models to `DashboardService`.
- Migrated dashboard sync from the watching-only compatibility path to `syncAnimeCollections` while keeping one in-flight sync promise.
- Added explicit wishlist start, pause, resume, safe known-total auto-completion, unknown-total manual completion, completed-title reopening, swap, skip-today, and replan-today actions.
- Kept every Bangumi write before its corresponding SQLite write and rebuilt the backlog plan once after each successful planner mutation.
- Preserved OAuth, local API-token protection, calendar, search, watched/unwatched, watched-through, reminder dismissal, and legacy uncollected `POST /api/subjects/:id/watching` behavior.
- Added strict canonical positive ID parsing, safe-integer rejection, strict wishlist year parsing, and an injectable Asia/Shanghai service clock.
- Added no frontend or notification changes.

## TDD Evidence

### Red

Initial dashboard service run:

```sh
npm test -- tests/server/dashboard.test.ts
```

```text
Test Files  1 failed (1)
Tests       18 failed | 8 passed (26)
```

Combined service and route contract run before implementation:

```sh
npm test -- tests/server/dashboard.test.ts tests/server/app.test.ts
```

```text
Test Files  2 failed (2)
Tests       28 failed | 29 passed (57)
```

The failures were the missing completion predicate, planner service methods, collection-sync migration, read routes, action routes, strict year parsing, and ID parsing. A separate safe-integer regression test failed with `204` instead of `400` before the parser check was added.

### Green

Required Task 6 verification:

```sh
npm test -- tests/server/dashboard.test.ts tests/server/app.test.ts tests/server/sync-integration.test.ts
npx tsc -p tsconfig.server.json --noEmit
```

```text
Test Files  3 passed (3)
Tests       64 passed (64)
TypeScript  exit 0
```

Additional checks:

```sh
npm run lint
npm run build
git diff --check
```

```text
ESLint      exit 0
Build       exit 0
Diff check  exit 0
```

## Repository-Wide Test Concern

`npm test` currently reports `141 passed, 1 failed`. The remaining failure is `tests/server/oauth-flow.test.ts`, which still expects one legacy type-3 collection request and provides no authoritative ACG season catalog. Task 6 correctly routes callback sync through Task 5's type-1/3/4 `syncAnimeCollections` contract, and the current plan assigns the full OAuth-to-planner flow test update to Task 9. The unowned OAuth test was not changed and the authoritative-season guard was not weakened.

## Coordination

Concurrent commit `783f85c` (`fix: require authoritative season data`) landed while Task 6 was in progress. Its `sync.ts` and sync-test changes were left untouched; Task 6 test doubles were updated to provide the now-required non-empty authoritative season window.

## Commit

- `feat: expose backlog planner actions`
