# Fixture setup

Race experiments mutate shared state. To make repeated attempts meaningful, every attempt must start
from a **known state**. RaceUI supports two strategies and always verifies a **baseline** before it
releases any race action.

## Strategy 1: reset (shared resource)

Your application (test build only) exposes a reset endpoint and a read-only endpoint that reports the
state you want to assert:

```yaml
fixtures:
  strategy: reset            # default
  reset:
    method: POST             # GET | POST | PUT | PATCH | DELETE
    path: /test-support/reset-seat-01
    headers:
      Authorization: 'Bearer ${RACEUI_FIXTURE_TOKEN}'
    body: { seat: seat-01 }  # optional JSON body
    timeoutMs: 10000
  baseline:
    get: /test-support/seat-01/booking-count
    headers:
      Authorization: 'Bearer ${RACEUI_FIXTURE_TOKEN}'
    pointer: /count          # RFC 6901 JSON Pointer
    equals: 0                # equals | notEquals | min | max
```

Per attempt RaceUI: closes all browser contexts of the previous attempt → calls `reset` → checks
`baseline` → creates fresh contexts → prepares actors → races.

- A non-2xx reset, a redirect, a timeout, or a baseline mismatch marks the attempt **INCONCLUSIVE**,
  dispatches **no** race action, and **stops the run** (remaining attempts are SKIPPED) because it is
  not safe to keep racing against an unknown state.
- Fixture calls never follow redirects and only go to approved origins.

## Strategy 2: unique resources

Instead of resetting, each attempt races on its own resource:

```yaml
fixtures:
  strategy: unique
  resourceTemplate: seat-${RUN_ID}-${ATTEMPT}   # -> e.g. seat-20261125-004516-2bad4a-003
  setup:                                        # optional, once per run (e.g. provision a batch)
    method: POST
    path: /test-support/provision?run=${RUN_ID}
  baseline:
    get: /test-support/${RESOURCE_ID}/booking-count
    pointer: /count
    equals: 0
```

Use `${RESOURCE_ID}` anywhere in paths, selectors, fill values, UI text and API checks. The resource
must exist (pre-provisioned, created by `setup`, or created lazily by your test build) and the
baseline must hold.

## Rules

- `repeat > 1` requires `reset` (or `strategy: unique`) **and** `baseline`. `repeat: 1` may omit both.
- Preparation steps must not consume the resource under test (e.g. do not click "book" in `prepare`).
- Test-support endpoints belong in test builds only. Protect them with a token passed through an
  environment variable (`${RACEUI_FIXTURE_TOKEN}`); RaceUI redacts it from every output.

## Example test-support endpoints

The bundled playground ([playground/server.mjs](../playground/server.mjs)) implements:

| Endpoint | Purpose |
|---|---|
| `POST /test-support/reset` | Clears seats, attendance and records |
| `GET /test-support/<seat>/booking-count` | `{ "count": n }` committed bookings |
| `GET /test-support/attendance/<employee>/count` | `{ "count": n }` attendance records today |
| `GET /test-support/records/<id>` | `{ "value", "version", "writes" }` |

All require `Authorization: Bearer <RACEUI_FIXTURE_TOKEN>` (default `dev-token`).
