---
name: raceui
description: Find race conditions and business-logic conflicts through real browser interactions with the RaceUI CLI. Use when asked to test double booking, overselling, duplicate submissions, double spending, concurrent approvals, quota conflicts, lost updates or other "two users, one resource" scenarios in a web application's local or authorized test environment.
---

# RaceUI skill

RaceUI runs 2-5 isolated browser sessions, holds them at a readiness barrier, releases one
competing UI action per session with controlled timing, and checks declared business invariants.
You (the agent) do the reasoning and author the scenario; RaceUI executes and verifies. RaceUI has
no LLM dependency.

## Ground rules

- Only target applications the user is authorized to test: local (`localhost`, `127.0.0.1`) by
  default. Never run state-changing races against production data. Non-loopback origins require the
  user to approve them and must be passed explicitly with `--allow-origin <origin>`.
- Use synthetic users, sandbox payments and disposable resources. Never print, commit or invent
  credentials; reference secrets as `${ENV_VAR}` placeholders.
- Never invent observed results, server timings or evidence. Report only what `report.json` says.
- Do not modify application code unless the user explicitly asks.

## Workflow

1. **Identify the shared resource and the invariant.** From requirements, source code or existing
   tests, name the mutable resource (seat, stock item, wallet, attendance record, approval...) and
   the rule that must hold (e.g. "at most one committed booking"). The test author decides what is
   correct; do not assume "exactly one success" is always right.
2. **Confirm the environment** is local or an authorized test environment and pick non-production
   credentials and fixtures. Ask the user if unsure.
3. **Choose identities.** Distinct users (one storage-state file or UI login per actor) or the same
   account in separate contexts (duplicate-submission tests). Each actor always gets its own browser
   context. Identify stable, unique locators (prefer `data-testid`).
4. **Prefer authoritative read-only checks.** Add an `api` assertion (GET + JSON Pointer) that reads
   the persisted state. If none exists, say the verdict is UI-only and lower confidence.
5. **Handle state between attempts.** For `repeat > 1` configure `fixtures.reset` (HTTP hook) or
   `fixtures.strategy: unique` with `resourceTemplate`, plus `fixtures.baseline`. RaceUI refuses to
   repeat without them.
6. **Author the smallest scenario**, then validate and run:

   ```bash
   raceui validate scenario.yaml
   raceui run scenario.yaml --repeat 10 --seed 42
   # non-loopback, user-approved test environment only:
   raceui run scenario.yaml --allow-origin https://staging.example.com
   ```

   Use `raceui init` to get a commented template. Run `raceui install-browser` once if Chromium is
   missing.
7. **Read the actual JSON report** (path printed as `Report: .../report.json`, or use `--json`) and
   cite evidence paths (`attempt-005/user-a.png`, `requests.json`, `timing.json`).
   - Exit `1` / `FAIL`: confirmed invariant violation. `failureKind: ui-outcome-mismatch` means only
     UI text disagreed; say so rather than claiming persisted corruption.
   - Exit `3` / `INCONCLUSIVE`: the experiment was invalid or incomplete (barrier timeout, locator
     error, baseline mismatch, verification endpoint down, timing threshold exceeded). Not a bug
     verdict; fix the scenario or environment.
   - Exit `0` / `PASS`: no violation was detected in N attempts. Never claim the system is race-free.
   - Exit `2`: invalid configuration or unapproved target. Exit `130`: interrupted.
8. **Report facts and limitations**, then suggest a regression scenario or bug report. Mention that
   the barrier is client-side: browser dispatch skew is measured, but server-side simultaneity is not
   guaranteed.

## Scenario reference (version 1)

```yaml
version: 1
name: concurrent-seat-booking          # letters, digits, . - _
baseUrl: http://127.0.0.1:3000          # all paths below are relative to this

actors:                                 # 2-5, unique ids
  - id: user-a
    storageState: ./auth/user-a.json    # optional Playwright storage state (relative to this file)
    prepare:                            # runs before the barrier; must NOT consume the resource
      - navigate: /booking/seat-01
      - fill: { selector: '#note', value: 'hi' }
      - click: '[data-testid="open-dialog"]'
      - waitFor: '[data-testid="confirm-booking"]'   # waits until visible
    race:                               # exactly one: click: <selector> | press: { selector, key }
      click: '[data-testid="confirm-booking"]'
  - id: user-b
    # ...

fixtures:                               # optional; required for repeat > 1
  strategy: reset                       # reset (default) | unique
  # resourceTemplate: seat-${RUN_ID}-${ATTEMPT}   # with strategy unique; use ${RESOURCE_ID} in paths/selectors/text
  setup:    { method: POST, path: /test-support/setup, headers: {...} }   # once per run
  reset:    { method: POST, path: /test-support/reset, headers: { Authorization: 'Bearer ${RACEUI_FIXTURE_TOKEN}' } }
  baseline: { get: /test-support/seat-01/booking-count, pointer: /count, equals: 0, headers: {...} }

timing:
  mode: simultaneous                    # simultaneous | staggered (offsetsMs per actor) | jitter (jitterMs, seeded)
  maxDispatchSkewMs: 100                # exceeding it makes a passing attempt INCONCLUSIVE
  barrierTimeoutMs: 30000
  prepareTimeoutMs: 30000
  actionTimeoutMs: 5000
  requestFilter: { method: POST, path: /api/bookings }   # optional: identifies the target request

assertions:
  settleMs: 500                         # wait after in-flight requests finish
  timeoutMs: 5000                       # bounded observation window
  pollMs: 250
  checks:                               # at least one
    - ui: { text: Booking successful, count: { equals: 1 } }   # counts actor pages showing exact visible text
    - ui: { actor: user-b, text: Seat unavailable }            # single actor: visible (count defaults to equals 1)
    - api:                                                     # read-only GET + JSON Pointer
        get: /test-support/seat-01/booking-count
        headers: { Authorization: 'Bearer ${RACEUI_FIXTURE_TOKEN}' }
        # actor: user-a                                        # or authenticate with an actor's cookies
        pointer: /count
        equals: 1                                              # equals | notEquals | min | max

run:
  repeat: 1                             # 1-100, sequential attempts with fresh contexts
  seed: 42                              # reproduces planned offsets (not OS/network/server ordering)
  browser: chromium
  evidence: on-failure                  # on-failure | always | none
```

Unknown keys, absolute URLs, arbitrary JavaScript and unresolved `${VAR}` placeholders are rejected.

## Example prompt

> Use the RaceUI skill to test concurrent employee attendance in our authorized staging environment.
> Prepare two isolated browser sessions for the same employee. Coordinate clock-in submissions,
> repeat the experiment with a fresh attendance fixture, and verify that at most one attendance
> record is committed. Return observed results, timing limitations and evidence paths. Do not change
> application code.
