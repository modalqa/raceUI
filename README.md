<p align="center">
  <img src="https://raw.githubusercontent.com/modalqa/raceUI/main/assets/raceui-logo.png" alt="RaceUI logo" width="520">
</p>

<h3 align="center">Two users. One resource. Zero room for bugs.</h3>

<p align="center">
  A lightweight, agent-friendly concurrency testing toolkit for discovering race conditions<br>
  and business-logic conflicts through <b>real browser interactions</b>.
</p>

---

RaceUI prepares 2–5 independent browser sessions, holds them at a readiness barrier, releases one
competing UI action per session with controlled timing, repeats the experiment, and verifies that
your business invariants still hold — with timing data, screenshots, sanitized request metadata and
an offline HTML report as evidence.

It is **not** a general E2E framework, a load-testing tool or an AI agent. It uses Playwright as the
browser engine, runs locally or in CI, and needs no LLM, API key, cloud service, dashboard or
database.

```text
      ▄████████████████████   ██████╗  █████╗  ██████╗███████╗██╗   ██╗██╗
      █████████████████████   ██╔══██╗██╔══██╗██╔════╝██╔════╝██║   ██║██║
      ██         █▄ ██▄█  █   ██████╔╝███████║██║     █████╗  ██║   ██║██║
      ██       ▄▄▄██████▄▄█   ██╔══██╗██╔══██║██║     ██╔══╝  ██║   ██║██║
      ██    ███████████████   ██║  ██║██║  ██║╚██████╗███████╗╚██████╔╝██║
  ▄▄▄▄██▄████████████████▀█   ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚══════╝ ╚═════╝ ╚═╝
▄████████▀▀▀     ███▀     █   Two users. One resource. Zero room for bugs.  v0.1.0
    ▄▄▄▄▄▄▄▄▄▄███▀▀▀      █
  ▄▄██████████▀███████████▀
```
<sub>The CLI banner (shown by <code>raceui</code>, <code>raceui --help</code>, <code>raceui init</code> and <code>raceui run</code>) is rendered from
<code>assets/raceui-logo.png</code> in truecolor when the terminal supports it. Disable with <code>NO_COLOR=1</code> or <code>raceui run --no-logo</code>.</sub>

## What it catches

| Pattern | Example | Invariant (you declare it) |
|---|---|---|
| Double booking | Two users reserve one seat | Exactly one committed booking |
| Overselling | Two customers buy the last item | At most one order; stock never negative |
| Duplicate submission | Same account submits from two devices | At most one logical operation |
| Double spending | Concurrent wallet debit | Total debit ≤ available balance |
| Concurrent approval | Two approvers process one request | Exactly one state transition |
| Quota conflict | Two sessions consume the last credit | Remaining quota never negative |
| Lost update | Two users edit one record | Final state follows the conflict policy |
| Delete/edit conflict | One deletes while another edits | No resurrection or invalid final state |

## Quickstart (≈5 minutes)

Requirements: Node.js 22+ on Windows, macOS or Linux.

```bash
git clone https://github.com/modalqa/raceUI.git && cd raceUI
npm install && npm run build
npx raceui install-browser            # downloads Playwright Chromium once (Linux: add --with-deps)
```

Start the bundled **deliberately vulnerable** playground in one terminal:

```bash
npx raceui-playground --mode vulnerable     # http://127.0.0.1:3000
```

Run the double-booking scenario in another:

```bash
# bash / zsh
export RACEUI_FIXTURE_TOKEN=dev-token
# PowerShell:  $env:RACEUI_FIXTURE_TOKEN = "dev-token"

npx raceui run examples/booking.yaml --repeat 3
```

Actual output from that run (logo banner omitted):

```text
RaceUI v0.1.0
Scenario: concurrent-seat-booking
Actors: 2 | Requested attempts: 3 | Seed: 42

Attempt 01/3 ...
Attempt 01: FAIL - GET /test-support/seat-01/booking-count#/count: expected 1, observed 2
...

PASS          0
FAIL          3
INCONCLUSIVE  0

Attempt 01: FAIL (invariant-violation)
  Browser action dispatch skew: 0.41 ms [within-threshold, threshold 100 ms]
  FAIL ui:"Booking successful"
    Expected successful booking confirmations: 1
    Observed successful booking confirmations: 2 (user-a, user-b)
  FAIL ui:"Seat unavailable"
    Expected: 1  Observed: 0
  FAIL GET /test-support/seat-01/booking-count#/count
    Expected committed bookings: 1
    Observed committed bookings: 2
  Note: Observed violation is client-side evidence; it does not by itself prove the server-side cause.
  Evidence: attempt-001/
...
Result: FAIL (exit 1)
Report: artifacts/raceui/20261125-011014-ff74ea/report.json
HTML:   artifacts/raceui/20261125-011014-ff74ea/report.html
```

Now restart the playground with `--mode fixed` (atomic reservation) and run again: every attempt
passes with exactly one booking and one `Seat unavailable` (exit `0`).

Start your own scenario with:

```bash
npx raceui init                 # writes ./raceui.yaml with inline instructions (never overwrites without --force)
npx raceui validate raceui.yaml
npx raceui run raceui.yaml
```

## How an attempt works

```text
Validate configuration and target policy
  -> Reset fixture (or create a unique resource) -> verify baseline
  -> Create one isolated BrowserContext per actor
  -> Prepare actors in parallel -> check race locator is unique, visible, enabled
  -> Readiness barrier (no partial release: all actors or none)
  -> Release: one click/press per actor at its planned offset (never retried)
  -> Wait for in-flight requests, settle, poll assertions within a bounded window
  -> Classify PASS / FAIL / INCONCLUSIVE -> capture evidence -> close contexts
```

The barrier is a client-side software synchronization point. RaceUI measures browser dispatch skew
and records browser-observed request timing, but never claims server-side simultaneity.

## CLI

```bash
raceui init [path] [--force]
raceui validate <file> [--repeat n] [--allow-origin o] [--json]
raceui run <file> [options]
raceui report <report.json> [--out file.html]           # regenerate the offline HTML report
raceui install-skill --agent claude|codex|cursor [--global] [--dir path] [--force]
raceui install-browser [--with-deps]                    # Playwright Chromium (Linux CI: --with-deps)
raceui --help | --version
```

| Option (`run`) | Behavior |
|---|---|
| `--repeat <n>` | Override repeat count (1–100) |
| `--seed <n>` | Override the deterministic schedule seed |
| `--headed` | Show browser windows for debugging |
| `--output <dir>` | Parent directory for the unique run directory (default `artifacts/raceui`) |
| `--evidence <mode>` | `on-failure` (default), `always`, `none` |
| `--trace <mode>` | Opt-in raw Playwright traces: `off` (default), `on-failure`, `always`. **Unredacted** — kept locally |
| `--stop-on-fail` | Stop after the first confirmed FAIL; later attempts are reported as SKIPPED |
| `--allow-origin <origin>` | Authorize a non-loopback test origin (repeatable) |
| `--json` | Print the JSON report to stdout |
| `--no-html` | Skip writing `report.html` |
| `--no-logo` | Hide the banner |

CLI flags override the matching `run:` settings and are recorded in the report's resolved config.

### Exit codes

| Code | Meaning |
|---:|---|
| 0 | All requested attempts PASS |
| 1 | One or more confirmed invariant violations (FAIL) — wins over INCONCLUSIVE |
| 2 | Invalid scenario/configuration, bad CLI usage, or unapproved target origin |
| 3 | No confirmed violation, but attempts INCONCLUSIVE or not completed |
| 130 | Interrupted (Ctrl+C); contexts are closed and a partial report is written |

CI runs never prompt. Loopback targets are allowed by default; anything else must be passed with
`--allow-origin` at invocation — a scenario file cannot authorize itself. See [docs/ci.md](docs/ci.md).

## Scenario reference

```yaml
version: 1
name: concurrent-seat-booking
baseUrl: http://127.0.0.1:3000           # every path below is relative to this origin

actors:                                  # 2–5 actors, unique ids, each in its own BrowserContext
  - id: user-a
    storageState: ./auth/user-a.json     # optional Playwright storage state (relative to this file)
    prepare:                             # navigate | fill {selector,value} | click | waitFor (visible)
      - navigate: /booking/seat-01
      - waitFor: '[data-testid="confirm-booking"]'
    race:                                # exactly one: click: <selector> | press: {selector, key}
      click: '[data-testid="confirm-booking"]'
  - id: user-b
    storageState: ./auth/user-b.json     # two actors with the SAME file need sharedIdentity: true
    prepare:
      - navigate: /booking/seat-01
    race:
      click: '[data-testid="confirm-booking"]'

fixtures:                                # required (reset or unique + baseline) when repeat > 1
  strategy: reset                        # reset | unique
  # resourceTemplate: seat-${RUN_ID}-${ATTEMPT}    # strategy unique -> use ${RESOURCE_ID}
  setup:  { method: POST, path: /test-support/setup }           # optional, once per run
  reset:
    method: POST
    path: /test-support/reset
    headers: { Authorization: 'Bearer ${RACEUI_FIXTURE_TOKEN}' }
  baseline:
    get: /test-support/seat-01/booking-count
    headers: { Authorization: 'Bearer ${RACEUI_FIXTURE_TOKEN}' }
    pointer: /count
    equals: 0

timing:
  mode: simultaneous                     # simultaneous | staggered (offsetsMs) | jitter (jitterMs, seeded)
  maxDispatchSkewMs: 100                 # simultaneous: skew; others: deviation from planned offsets
  barrierTimeoutMs: 30000
  prepareTimeoutMs: 30000
  actionTimeoutMs: 5000
  requestFilter: { method: POST, path: /api/bookings }   # optional: labels the target request

assertions:
  settleMs: 500
  timeoutMs: 5000                        # bounded observation window; last observation is reported
  pollMs: 250
  checks:
    - ui:                                # distinct actor pages showing the exact visible text
        label: successful bookings       # optional: "Expected successful bookings: 1" in output
        text: Booking successful
        count: { equals: 1 }             # equals | min | max
    - ui: { actor: user-b, text: Seat unavailable }           # one actor (count defaults to equals: 1)
    - api:
        label: committed bookings
        get: /test-support/seat-01/booking-count              # read-only GET
        headers: { Authorization: 'Bearer ${RACEUI_FIXTURE_TOKEN}' }   # or actor: user-a (its cookies)
        pointer: /count                                       # RFC 6901 JSON Pointer
        equals: 1                                             # equals | notEquals | min | max
        pollMs: 250

run:
  repeat: 20                             # default 1, max 100; attempts are sequential
  seed: 42                               # default: random (always recorded in the report)
  browser: chromium
  evidence: on-failure                   # on-failure | always | none
  trace: off                             # off | on-failure | always (unredacted, local only)
```

Rules enforced before any browser starts: unknown keys, duplicate actor ids, missing references,
unsupported actions, absolute URLs, out-of-range limits, implicit shared identities and unresolved
`${VAR}` placeholders are rejected. `${RUN_ID}`, `${ATTEMPT}` and `${RESOURCE_ID}` are resolved per
attempt. Fixture details: [docs/fixtures.md](docs/fixtures.md).

More examples: [examples/booking.yaml](examples/booking.yaml),
[examples/booking-unique.yaml](examples/booking-unique.yaml) (unique resources + seeded jitter),
[examples/duplicate-attendance.yaml](examples/duplicate-attendance.yaml) (same account, staggered),
[examples/lost-update.yaml](examples/lost-update.yaml) (optimistic-locking policy).

## Results and evidence

| Result | Meaning |
|---|---|
| **PASS** | All invariants held, actions completed, timing within the threshold. Only means no violation was *detected*. |
| **FAIL** | An invariant was observably violated. `failureKind: invariant-violation` when an authoritative API check failed; `ui-outcome-mismatch` when only UI text disagreed. |
| **INCONCLUSIVE** | Invalid baseline, reset failure, readiness timeout, locator/action error, verification endpoint unavailable, timing threshold exceeded, or missing required evidence. |
| **SKIPPED** | Not executed (`--stop-on-fail`, unsafe continuation after reset/baseline failure, interrupt). |

```text
artifacts/raceui/<run-id>/
  report.json              # schemaVersion 1: every attempt, per-actor timing, assertions, fixture status,
                           # errors, environment/browser version, redacted resolved config
  report.html              # static offline report generated from report.json (no server, no scripts)
  attempt-005/
    user-a.png  user-b.png # full-page screenshots per actor
    requests.json          # sanitized browser-side request metadata (no bodies)
    timing.json            # planned vs. actual offsets, dispatch/completion times
    user-a-trace.zip       # only with --trace (unredacted; open with: npx playwright show-trace)
```

Evidence paths in the report are relative to the run directory. A partial `report.json` (and
`report.html`) is rewritten after every attempt. Assertion entries carry `expected` (the plain value
for `equals`, e.g. `1`), the full `comparison` (e.g. `{"max": 1}`) and the `observed` value.

## Using RaceUI from coding agents

The portable skill lives at [skills/raceui/SKILL.md](skills/raceui/SKILL.md). It teaches an agent to
find the shared resource and invariant, confirm an authorized environment, author the smallest
scenario, run the CLI, and report only what the JSON report says.

```bash
raceui install-skill --agent claude    # -> .claude/skills/raceui/SKILL.md
raceui install-skill --agent codex     # -> .agents/skills/raceui/SKILL.md
raceui install-skill --agent cursor    # -> .cursor/skills/raceui/SKILL.md
# add --global to install for your user (~/.claude, ~/.agents, ~/.cursor) instead of the project
```

| Agent | Skill location | Verification status (v0.1) |
|---|---|---|
| Claude Code | `.claude/skills/raceui/` | Installation + skill discovery verified headless with Claude Code CLI (see CHANGELOG) |
| OpenAI Codex | `.agents/skills/raceui/` | Location per Codex docs; not executed end-to-end here |
| Cursor | `.cursor/skills/raceui/` (Cursor also reads `.claude/skills/`) | Location per Cursor docs; not executed end-to-end here. Fallback: reference `SKILL.md` from a rule or `AGENTS.md` |
| Other agents | Point the agent at `SKILL.md` and the `raceui` CLI | — |

Example prompt:

> Use the RaceUI skill to test concurrent employee attendance in our authorized staging
> environment. Prepare two isolated browser sessions for the same employee. Coordinate clock-in
> submissions, repeat the experiment with a fresh attendance fixture, and verify that at most one
> attendance record is committed. Return observed results, timing limitations and evidence paths.
> Do not change application code.

## Safety

- Only test applications you are authorized to test, with synthetic users and disposable data.
  Non-loopback origins require `--allow-origin`.
- Browser requests to unapproved origins are aborted and service workers are blocked (best effort —
  not a network sandbox). Fixture and API calls never follow redirects.
- Scenario files cannot run shell commands or JavaScript. Secrets come from `${ENV}` placeholders and
  are redacted from reports along with authorization/cookie headers and sensitive query parameters.
  Screenshots can still show sensitive UI and traces are unredacted — keep artifacts private.
- Never commit storage-state files or artifacts. Suggested `.gitignore`:

  ```gitignore
  auth/
  artifacts/
  ```

- No telemetry, uploads or AI requests. See [SECURITY.md](SECURITY.md).

## Platform and benchmark status

| Item | Status |
|---|---|
| Windows 11 (Node 22.16, Chromium 159) | Full unit + integration suite passes (67 tests) |
| Linux: Ubuntu 24.04.5 (Node 26.13, official `mcr.microsoft.com/playwright:v1.65.1-noble` image) | Full unit + integration suite passes (67 tests) + CLI smoke |
| macOS | Not tested yet (no macOS machine available); no macOS-specific code paths |
| Benchmarks (NFR-02 / NFR-03) | See [docs/benchmarks.md](docs/benchmarks.md); reproduce with `npm run bench` |
| Runtime dependency licenses | MIT / ISC / Apache-2.0 only; verify with `npm run licenses` |

## Known limitations (v0.1)

- Chromium only; one race action per actor per attempt; 2–5 actors; up to 100 sequential attempts.
- Simultaneous dispatch in the browser does not guarantee simultaneous arrival at the server.
  Replaying a seed reproduces planned offsets, not OS scheduling, network behavior or server ordering.
- Narrow race windows may need more repeats or jitter; passing runs never prove absence of races.
- Playwright actionability checks add latency between dispatch and the actual click (visible as
  `completedMs` and request `startMs` in the report).
- Browser origin restrictions are best effort, not a network sandbox.

Troubleshooting: [docs/troubleshooting.md](docs/troubleshooting.md).

## Development

```bash
npm install
npm run build             # TypeScript -> dist/
npm test                  # unit tests (barrier, scheduler, schema, classification, redaction, policy)
npm run test:integration  # Playwright against vulnerable/fixed playgrounds + CLI contract (needs Chromium)
npm run bench             # reference benchmark (NFR-02/03)
npm run licenses          # runtime dependency license check
npm run logo              # regenerate the terminal logo from assets/raceui-logo.png (Python + Pillow)
```

Project layout: `src/cli` (commands, banner), `src/schema` (YAML + Zod validation),
`src/engine` (runner, sessions, barrier, scheduler, fixtures), `src/assertions`, `src/evidence`,
`src/reporters` (JSON, terminal, HTML), `src/security`, `playground/`, `examples/`, `skills/raceui/`,
`docs/`, `tests/`.

See [CONTRIBUTING.md](CONTRIBUTING.md) and [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
