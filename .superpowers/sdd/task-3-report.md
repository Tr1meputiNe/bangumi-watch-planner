# Task 3 Report

## Scope

Changed owned files:

- `src/server/types.ts`
  - Added `BroadcastSchedule`, `SeasonEntry`, `SeasonCatalog`, `SeasonWindow`, and `BroadcastCatalog` contracts.
  - Added the optional `getBroadcastCatalog` client contract without removing Task 2 compatibility methods.
- `src/server/broadcast-schedule.ts`
  - Added pure ACG quarter parsing for new and continuing entries.
  - Added current/previous-quarter catalog fetches while preserving Bangumi fallbacks and ACG precedence.
  - Kept `fetchBroadcastTimes` as a compatibility wrapper over the normalized catalog.
- `src/server/season-window.ts`
  - Added Shanghai quarter arithmetic and the inclusive 14-natural-day overlap window.
- `tests/server/broadcast-schedule.test.ts`
  - Added parser, current/previous fetch, invalid-link, and weekday-derived next-day coverage.
  - Retained ACG precedence and all existing late-night schedule regressions.
- `tests/server/season-window.test.ts`
  - Added quarter rollover, URL, exact overlap boundary, and fallback-anchor coverage.

No parser dependency was added. Existing `花枝和才女的侍从`, `猫与龙`, 24+/25+ next-day, ACG override, and one-week episode corrections remain covered by the broadcast and sync suites.

## TDD Evidence

### Red

Command before implementation:

```sh
npm test -- tests/server/broadcast-schedule.test.ts tests/server/season-window.test.ts
```

Output:

```text
Test Files  2 failed (2)
Tests  2 failed | 1 passed (3)
Error: Cannot find module '../../src/server/season-window.js'
TypeError: parseAcgSecretsSeason is not a function
TypeError: fetchBroadcastCatalog is not a function
```

The failures were the expected missing Task 3 module and exports.

### Green

Required regression command:

```sh
npm test -- tests/server/broadcast-schedule.test.ts tests/server/season-window.test.ts tests/server/sync.test.ts
```

Output:

```text
Test Files  3 passed (3)
Tests  13 passed (13)
```

Additional verification:

```sh
npm test
npm run build
npm run lint
git diff --check
```

Output:

```text
Test Files  13 passed (13)
Tests  100 passed (100)
npm run build: exit 0
npm run lint: exit 0
git diff --check: exit 0
```

## Concerns

- The brief's sample timestamp `1783177200000` is `2026-07-04 23:00` in `Asia/Shanghai`, not the stated `2026-07-05 00:00`. The regression uses `1783180800000`, which is the timestamp matching the required Shanghai date/time and existing ACG correction behavior.
