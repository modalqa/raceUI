# RaceUI — Product Requirements Document

> **Two users. One resource. Zero room for bugs.**

| Document | Details |
|---|---|
| Product | RaceUI (working name) |
| Version | PRD 1.0 — MVP v0.1 |
| Status | Proposed / ready for technical implementation planning |
| Product type | Open-source CLI and Agent Skill |
| License | MIT (proposed) |
| Target platform | Windows, macOS, Linux and CI/CD |
| Primary stack | TypeScript, Node.js, Playwright, YAML |

## 1. Product overview

RaceUI is a lightweight, agent-friendly concurrency testing toolkit for discovering race conditions and business logic conflicts through real browser interactions.

RaceUI allows QA engineers, developers and AI coding agents to prepare multiple independent browser sessions, synchronize competing user actions against a shared resource, repeat experiments with controlled timing, and verify whether the application's business invariants hold.

RaceUI is not a general-purpose test automation framework, a load-testing tool, or an AI agent. It complements existing testing tools and uses Playwright as its browser execution engine. It does not require an LLM, AI API key, cloud service, dashboard or internal database.

### 1.1 Problem statement

Traditional UI automation frequently validates a workflow using a single user session. Parallel test execution normally improves throughput rather than deliberately coordinating competing actions. Load testing emphasizes capacity and performance, while request-level race testing may bypass real UI behavior. Teams can implement concurrency experiments manually, but must repeatedly build session isolation, synchronization, timing observation, business assertions, fixture reset and evidence collection.

Examples of defects that may remain undiscovered:

- Two customers successfully book the last available seat.
- Two checkout sessions purchase the same last item.
- One employee creates duplicate attendance records from two devices or browser sessions.
- Two managers approve the same request and trigger duplicate side effects.
- Two operations consume the same remaining wallet balance or quota.
- A stale edit silently overwrites another user's update.

### 1.2 Value proposition

Define a race scenario once, run competing browser actions repeatedly, and produce reproducible evidence of business-rule violations with as little custom orchestration as possible.

The differentiation is packaging and workflow, not a claim that browser concurrency testing is new or that existing tools cannot perform it.

## 2. Goals and non-goals

### 2.1 MVP goals

1. Execute synchronized UI actions from 2–5 independent browser contexts using a single local browser instance by default.
2. Support repeatable concurrency experiments with simultaneous-release and staggered-release schedules.
3. Verify explicit business invariants using UI outcomes and optional authoritative read-only API checks.
4. Capture per-attempt timing, screenshots and redacted request metadata sufficient for investigation.
5. Provide a small declarative YAML format, CLI, and reusable `SKILL.md` for Claude Code, Codex and Cursor.
6. Support CI execution with machine-readable JSON, deterministic exit codes and documented fixture-reset requirements.
7. Keep setup lightweight and compatible with an existing web application without requiring application source access for basic UI scenarios.

### 2.2 Non-goals for v0.1

- General E2E test authoring, self-healing selectors, test generation or AI-generated verdicts within RaceUI.
- Distributed execution, high-volume load testing, cloud browser farms or network-packet-level synchronization.
- Native Android/iOS testing, desktop automation or multi-device hardware orchestration.
- Web dashboard, hosted SaaS, internal database, account management or telemetry by default.
- Native MCP server, GUI recorder, direct database adapters, arbitrary code inside YAML, autonomous bug fixing or production exploitation.
- Guaranteeing server-side simultaneity or proving that a system is race-free.

## 3. Target users and use cases

| Persona | Primary need |
|---|---|
| QA engineer / SDET | Find intermittent multi-user defects and collect evidence for bug reports. |
| Software developer | Reproduce concurrency failures while implementing or fixing transactional logic. |
| Engineering manager / QA lead | Establish repeatable concurrency regression checks for critical workflows. |
| AI coding agent user | Ask Claude Code, Codex or Cursor to create and execute focused race scenarios. |
| CI maintainer | Block a release when a defined concurrency invariant is violated or required evidence is missing. |

### 3.1 Supported scenario patterns

| Pattern | Example | Required invariant (illustrative) |
|---|---|---|
| Overselling | Two customers buy the last item | At most one committed order; stock never negative |
| Double booking | Two users reserve one seat | Exactly one committed booking when both attempts are valid and the seat starts free |
| Duplicate submission | Same account submits from two sessions | At most one logical operation is committed |
| Double spending | Concurrent wallet debit | Total committed debit does not exceed available balance |
| Concurrent approval | Two approvers process one request | Exactly one state transition / side effect when approval is otherwise valid |
| Quota conflict | Two sessions consume last credit | Remaining quota is nonnegative and consumption respects allowance |
| Lost update | Two users edit a shared record | Final state follows the application's declared conflict policy |
| Delete/edit conflict | One user deletes a record while another edits | No unintended resurrection or invalid final state |
| Same-account conflict | Two authenticated contexts use one identity | Application's explicit session or duplicate-operation policy holds |

Expected outcomes are supplied by the test author. RaceUI must not assume all concurrent actions are invalid or that exactly one success is universally correct.

## 4. Product experience

### 4.1 Human workflow

1. Install RaceUI and browser dependencies.
2. Create a scenario template using `raceui init`.
3. Prepare test users, authenticated storage states, a shared test resource and optional fixture-reset endpoint.
4. Define preparation steps, race actions, timing schedule and business assertions.
5. Validate configuration, then execute locally or in CI.
6. Inspect failed attempts, evidence and final-state assertions; reproduce with the recorded seed and timing parameters.
7. Add the scenario to regression testing after fixing the underlying application defect.

### 4.2 Coding agent workflow

```text
User request
  -> Claude Code / Codex / Cursor reads RaceUI SKILL.md
  -> Agent identifies shared resource, identities and expected business rules
  -> Agent inspects application / existing tests, then authors scenario YAML
  -> Agent validates scenario and runs RaceUI CLI
  -> RaceUI executes actual browser actions and deterministic assertions
  -> Agent reads JSON and evidence, reports facts and limitations
```

The coding agent performs reasoning and scenario authoring. RaceUI performs execution and verification. Agent access to a repository or browser is governed by that agent's own permissions.

## 5. Functional requirements

Priority: P0 = required for MVP release; P1 = optional polish after P0 is stable.

| ID | Priority | Requirement | Acceptance criterion |
|---|---|---|---|
| FR-01 | P0 | YAML scenario parser and strict validation | Reject unknown keys, invalid types, duplicate actor IDs, missing references, unsupported actions and out-of-range limits before launching a browser. |
| FR-02 | P0 | Independent browser sessions | Each actor has its own BrowserContext, cookies, storage and page; optional Playwright storage-state file initializes each context. Shared account identity is allowed when explicitly configured. |
| FR-03 | P0 | Preparation steps | Execute each actor's navigation, fill, click and wait steps in order; actors may prepare in parallel. A preparation failure prevents race release. |
| FR-04 | P0 | Readiness barrier | All actors must complete preparation and reach the barrier before any race action is scheduled. Timeout or missing readiness yields an inconclusive attempt. |
| FR-05 | P0 | Timing scheduler | Support zero-offset release, explicit per-actor offsets, and seeded bounded jitter. Record planned and observed action timestamps. |
| FR-06 | P0 | Race action execution | Execute one click or supported key press per actor per attempt. Capture dispatch results without automatically retrying a mutation. |
| FR-07 | P0 | Repeat and seed | Run sequential attempts with fresh contexts; reset or isolate resources between attempts. Save seed and resolved offsets for reproduction. |
| FR-08 | P0 | UI assertions | Evaluate actor-specific and aggregate visible-text outcomes; support exact count, minimum and maximum; enforce explicit settle and assertion timeouts. |
| FR-09 | P0 | Read-only API assertions | Evaluate GET JSON responses via explicit JSON Pointer and typed comparison operators. Support bounded polling and configurable observer authentication. |
| FR-10 | P0 | Fixture lifecycle | Support an optional explicitly configured setup/reset HTTP hook and baseline API assertion. Require reset or explicit independent fixture strategy for repeats. Stop safely when reset/baseline fails. |
| FR-11 | P0 | Evidence and reports | Emit terminal summary and versioned JSON with attempts, assertions, timings, errors and artifact paths. Save screenshots and sanitized request metadata for failed/inconclusive attempts by default. |
| FR-12 | P0 | CLI and CI | Provide init, validate and run commands; return documented exit codes; no interactive prompts during CI runs. |
| FR-13 | P0 | Agent Skill | Ship a reusable `SKILL.md`, installation guidance for supported agents and a prompt example; no LLM dependency. |
| FR-14 | P0 | Safe cleanup | Close browser contexts on completion, failure or interruption; enforce timeouts and an explicit target-origin policy. |
| FR-15 | P1 | Playwright trace capture | Opt-in raw trace per attempt with explicit sensitive-data warning; retain traces locally by default. |
| FR-16 | P1 | Standalone HTML report | Generate a static offline report from sanitized JSON; no dashboard server needed. |

## 6. Scenario contract (proposed v0.1)

A small YAML DSL defines actors, setup, race action, timing and assertions. The initial release deliberately avoids a general scripting language.

```yaml
version: 1
name: concurrent-seat-booking
baseUrl: http://localhost:3000

actors:
  - id: user-a
    storageState: ./auth/user-a.json
    prepare:
      - navigate: /booking/seat-01
      - waitFor: '[data-testid="confirm-booking"]'
    race:
      click: '[data-testid="confirm-booking"]'

  - id: user-b
    storageState: ./auth/user-b.json
    prepare:
      - navigate: /booking/seat-01
      - waitFor: '[data-testid="confirm-booking"]'
    race:
      click: '[data-testid="confirm-booking"]'

fixtures:
  reset:
    method: POST
    path: /test-support/reset-seat-01
    headers:
      Authorization: 'Bearer ${RACEUI_FIXTURE_TOKEN}'
  baseline:
    get: /test-support/seat-01/booking-count
    headers:
      Authorization: 'Bearer ${RACEUI_FIXTURE_TOKEN}'
    pointer: /count
    equals: 0

timing:
  mode: simultaneous
  maxDispatchSkewMs: 100
  barrierTimeoutMs: 10000
  actionTimeoutMs: 5000

assertions:
  settleMs: 500
  timeoutMs: 5000
  checks:
    - ui:
        text: Booking successful
        count:
          equals: 1
    - ui:
        text: Seat unavailable
        count:
          equals: 1
    - api:
        get: /test-support/seat-01/booking-count
        headers:
          Authorization: 'Bearer ${RACEUI_FIXTURE_TOKEN}'
        pointer: /count
        equals: 1
        pollMs: 250

run:
  repeat: 20
  seed: 42
  browser: chromium
  evidence: on-failure
```

The URLs, selectors, messages and reset endpoint are illustrative contracts for a demo application; a real project must supply equivalent resources. This is the proposed configuration API, not a currently executable package.

### 6.1 Configuration rules

- Required: `version`, `name`, `baseUrl`, at least two unique actors, one race action per actor and at least one assertion.
- Actors: 2–5 by default. Storage-state files are optional for unauthenticated tests; actors always receive separate contexts. Paths are relative to the scenario file.
- Preparation supports `navigate`, `fill: {selector, value}`, `click`, and `waitFor`; navigation uses the approved origin. Wait steps require the locator to be visible. Preparation must not silently consume the resource under test.
- Race actions support `click: selector` and `press: {selector, key}`. Locators should be stable and unique; avoid forced clicks and arbitrary JavaScript evaluation.
- Timing modes: `simultaneous` (zero offsets), `staggered` (`offsetsMs` map keyed by actor ID), and `jitter` (`jitterMs` nonnegative bound with seeded offsets). Offsets are relative to the barrier release.
- `maxDispatchSkewMs` bounds the observed spread for simultaneous mode, or deviation from planned relative offsets for other modes; exceeding it makes a passing experiment inconclusive, rather than claiming a meaningful simultaneous test. An independently established invariant violation is still reported as a failure, with timing caveats.
- UI assertions count distinct actor pages matching visible exact text, not individual DOM nodes; optional `actor` restricts the check to one named actor. Observe terminal states within a bounded assertion window.
- API assertions use explicit GET endpoints, JSON Pointer (RFC 6901), and typed `equals`, `notEquals`, `min`, or `max` checks. Authentication is explicit via headers or an optional named actor context. No raw SQL or arbitrary executable code in YAML.
- API polling is bounded by assertion timeout; the final observation is used for final-state assertions. A temporarily correct value does not prove the final invariant if it changes within the observation window. Authors must select a suitable observation window for asynchronous systems.
- Environment-variable placeholders are supported for secret values; unresolved variables are configuration errors. Never print resolved secrets in output.
- Repeated attempts require a reset hook or explicit independent-resource mode (e.g. `fixtures: { strategy: unique, resourceTemplate: "seat-${RUN_ID}-${ATTEMPT}" }` with a pre-provisioned or setup-created resource and verified baseline). For shared mutable resources, require baseline validation before racing.
- Default `repeat` is 1; maximum 100 in MVP. Runs are sequential, while actors within an attempt are concurrent. Limits are intentional safeguards and not load capacity claims.
- Default browser: Chromium. Additional engines are deferred unless compatibility is verified.

## 7. Race engine design

### 7.1 Attempt lifecycle

```text
Validate configuration and target policy
  -> Resolve attempt seed and resource ID
  -> Reset or prepare isolated fixture
  -> Verify baseline
  -> Create isolated browser contexts
  -> Prepare each actor in parallel
  -> Check target locator readiness
  -> Wait at readiness barrier
  -> Release and schedule race actions
  -> Observe action results and request metadata
  -> Wait / poll for declared outcomes
  -> Evaluate business invariants and timing quality
  -> Capture evidence and classify result
  -> Close contexts and finalize attempt
  -> Repeat with a fresh fixture or stop
```

The barrier is a software synchronization mechanism, not a network or database lock. Locator readiness is checked before release; Playwright actionability checks and browser scheduling can still introduce latency after release. No automatic action retries are issued by RaceUI. The engine must await or cancel outstanding operations before starting the next attempt; close contexts before fixture reset.

### 7.2 Timing model

For each actor record:

- Preparation completed timestamp.
- Planned offset and actual runner dispatch timestamp.
- Playwright action completion timestamp.
- Observed request-start and response timestamps for relevant requests (when available).
- Action, timeout and browser errors.

Use a monotonic runner clock for scheduling and relative intervals, and wall-clock UTC timestamps for correlation. Request events represent browser/client-side observations, not server receive times. Optional request filters (`method`, `path` or configured URL pattern) identify the target operation. Background requests or ambiguous matches must be labeled; absent request timing is not fabricated.

`dispatchSkewMs = max(dispatchMs) - min(dispatchMs)` for simultaneous mode. Staggered/jitter mode records offset error relative to the intended schedule. Report both planned and actual values. Replaying a seed reproduces the schedule inputs, not OS scheduling, network behavior or server ordering.

### 7.3 Result classification

| Result | Meaning |
|---|---|
| PASS | All required invariants hold, preparation and actions completed as required, and timing/evidence meet the declared validity policy. |
| FAIL | At least one required business invariant is observably violated with sufficient evidence. A UI-only failure is explicitly labeled as a UI outcome mismatch, not automatically a persisted data conflict. |
| INCONCLUSIVE | Invalid baseline, readiness timeout, ambiguous outcome, timing threshold exceeded without a proven violation, missing required evidence, unavailable verification endpoint, or infrastructure/action error. |

A verified business-rule violation takes precedence over timing uncertainty, but must not be attributed conclusively to a server-side race without supporting evidence. A failed locator is an execution error, not proof of a race. A non-2xx response is not automatically a defect; expected conflict responses may be valid. If no violation is observed, report only that the specified attempts did not detect one.

### 7.4 Aggregate result and exit codes

| Exit code | Run result |
|---:|---|
| 0 | All requested attempts PASS. |
| 1 | One or more confirmed invariant violations (FAIL). |
| 2 | Invalid scenario/configuration or unsafe target policy. |
| 3 | No confirmed violation, but one or more attempts are INCONCLUSIVE or not completed. |
| 130 | User interruption (SIGINT, where supported). |

When both FAIL and INCONCLUSIVE exist, preserve all attempt statuses and use exit 1. Configuration is validated before any mutation. Infrastructure failures stop further attempts when safe continuation cannot be established.

## 8. CLI specification

Proposed package name: `raceui` (subject to npm and repository availability).

```bash
npm install -g raceui
raceui install-browser
raceui init
raceui validate ./booking.yaml
raceui run ./booking.yaml
raceui run ./booking.yaml --repeat 20 --seed 42
raceui run ./booking.yaml --headed
raceui run ./booking.yaml --output ./artifacts/raceui
```

`raceui install-browser` delegates to the bundled Playwright browser installer for Chromium; document system dependency installation for supported Linux CI environments. Standard Playwright installation is an alternative.

| Command / option | Behavior |
|---|---|
| `init [path]` | Write example YAML and instructions without overwriting existing files unless explicitly authorized. |
| `validate <file>` | Validate schema, references, environment variables and local input files without opening the target. |
| `run <file>` | Execute scenario and output terminal summary plus JSON. |
| `--repeat <n>` | Override repeat count within supported limits. |
| `--seed <n>` | Override deterministic schedule seed. |
| `--headed` | Display browser window for debugging. |
| `--output <dir>` | Write a unique run directory under the selected path. |
| `--stop-on-fail` | Stop after first confirmed failed attempt; mark skipped attempts in report. |
| `--allow-origin <origin>` | Explicitly authorize a non-loopback test origin; repeatable flag. |
| `--help`, `--version` | Standard CLI metadata. |

Loopback targets are allowed by default. Non-loopback targets require explicit allowlisting at invocation; scenario configuration cannot grant itself extra authorization. CI must provide approved staging origins explicitly. Do not prompt for credentials. CLI flags override corresponding YAML run settings and are recorded in resolved configuration after redaction.

## 9. Evidence and reporting

### 9.1 Terminal output (illustrative)

```text
RaceUI v0.1.0
Scenario: concurrent-seat-booking
Actors: 2 | Requested attempts: 20 | Seed: 42

PASS          17
FAIL           2
INCONCLUSIVE   1

Attempt 05: FAIL
  Browser action dispatch skew: 4 ms
  Expected committed bookings: 1
  Observed committed bookings: 2
  Evidence: attempt-005/

Result: FAIL (exit 1)
Report: artifacts/raceui/<run-id>/report.json
```

### 9.2 JSON report contract

```json
{
  "schemaVersion": 1,
  "runId": "example-run",
  "scenario": "concurrent-seat-booking",
  "seed": 42,
  "status": "FAIL",
  "summary": {
    "requested": 20,
    "executed": 20,
    "passed": 17,
    "failed": 2,
    "inconclusive": 1,
    "skipped": 0
  },
  "attempts": [
    {
      "index": 5,
      "status": "FAIL",
      "timing": {"dispatchSkewMs": 4, "quality": "within-threshold"},
      "assertions": [
        {"type": "api", "pointer": "/count", "expected": 1,
         "observed": 2, "status": "FAIL"}
      ],
      "evidence": ["attempt-005/user-a.png", "attempt-005/user-b.png"]
    }
  ]
}
```

Example is abbreviated; actual JSON must include all executed attempts, per-actor observations, resolved timing, fixture status, errors, assertion sources, skipped counts, environment/browser version and relative artifact paths.

### 9.3 Artifact layout

```text
artifacts/raceui/<run-id>/
  report.json
  attempt-005/
    user-a.png
    user-b.png
    requests.json
    timing.json
  attempt-012/
    ...
```

Evidence modes: `on-failure` (default, includes inconclusive), `always`, `none`. JSON summaries and timing classification remain available in every mode. If explicitly required evidence cannot be captured, report the limitation rather than silently claiming complete proof. Raw traces (P1) may include sensitive content and require explicit opt-in; never upload automatically.

## 10. Agent Skill integration

Ship `skills/raceui/SKILL.md` using a portable Agent Skills format with tool-specific installation notes. The skill should instruct agents to:

1. Identify a shared mutable resource and the business invariant from requirements, source code or existing tests.
2. Confirm that the target is an authorized local/test environment and select non-production credentials and fixtures.
3. Determine distinct-user or same-account scenarios, prepare separate storage states, and identify stable locators.
4. Prefer authoritative read-only final-state checks when available; otherwise label confidence as UI-only.
5. Build reset and baseline handling for repeated state-changing attempts.
6. Author the smallest YAML scenario, validate it, and run the CLI.
7. Read the actual JSON report and cite evidence paths. Distinguish confirmed violations from incomplete runs; never invent observed results or server timing.
8. Suggest a regression test or bug report, but do not modify application code unless asked.

Example prompt:

> Use the RaceUI skill to test concurrent employee attendance in our authorized staging environment. Prepare two isolated browser sessions for the same employee. Coordinate clock-in submissions, repeat the experiment with a fresh attendance fixture, and verify that at most one attendance record is committed. Return observed results, timing limitations and evidence paths. Do not change application code.

### 10.1 Compatibility target

| Agent | Delivery |
|---|---|
| Claude Code | Project skill plus CLI instructions |
| OpenAI Codex | Project skill plus CLI instructions |
| Cursor | Project skill where supported; documented agent instructions as fallback |
| Other coding agents | Portable SKILL.md and CLI |

Test installation and execution in each supported agent before publishing compatibility claims. No plugin marketplace or native API integration is required for MVP.

## 11. Technical architecture

```text
Human / CI / Coding Agent
           |
        CLI layer
           |
  Schema + target policy
           |
       Race Runner
   +-------+---------+-------------+
   |       |         |             |
Fixture  Browser   Barrier &    Assertion
Manager  Sessions  Scheduler    Engine
   |       |         |             |
   +-------+---------+-------------+
           |
    Timing & Evidence
           |
       JSON / Terminal
```

| Component | Responsibility |
|---|---|
| CLI | Parse arguments, display summary, map exit codes, manage run directories. |
| Schema | YAML parsing, strict Zod validation, variable resolution and reference checks. |
| Fixture manager | Approved setup/reset, baseline verification and unique resource lifecycle. |
| Session manager | Playwright launch, contexts, storage state, preparation and cleanup. |
| Barrier | Readiness tracking, timeout and coordinated release. |
| Scheduler | Monotonic timing, explicit offsets and seeded jitter. |
| Assertion engine | UI aggregate checks, read-only API comparisons and result classification. |
| Evidence collector | Sanitized request metadata, screenshots and per-actor timing. |
| Reporter | Versioned report, terminal output and optional static HTML. |

### 11.1 Technology stack

| Layer | Choice |
|---|---|
| Language | TypeScript with strict mode |
| Runtime | Node.js LTS; initial minimum Node.js 22 (verify supported dependency matrix before release) |
| Package manager / distribution | npm |
| Browser engine | Playwright, Chromium initially |
| CLI | Commander.js |
| YAML | `yaml` package, restricted declarative parsing |
| Validation | Zod |
| Unit and integration tests | Vitest + Playwright |
| Agent integration | SKILL.md + installation guides |
| CI | GitHub Actions on Linux; Windows/macOS smoke tests |
| License | MIT (subject to final maintainer approval) |

Use a single npm package, one process and one local browser instance for MVP. Avoid Redis, databases, Docker as a mandatory dependency, microservices, external queues or additional orchestration frameworks.

### 11.2 Repository structure

```text
raceui/
├── src/
│   ├── cli/
│   ├── schema/
│   ├── engine/
│   │   ├── runner.ts
│   │   ├── sessions.ts
│   │   ├── barrier.ts
│   │   ├── scheduler.ts
│   │   └── fixtures.ts
│   ├── assertions/
│   ├── evidence/
│   ├── reporters/
│   └── security/
├── skills/raceui/SKILL.md
├── examples/
│   ├── booking.yaml
│   ├── duplicate-attendance.yaml
│   └── lost-update.yaml
├── playground/
├── tests/
│   ├── unit/
│   └── integration/
├── .github/workflows/
├── package.json
├── README.md
├── CONTRIBUTING.md
├── SECURITY.md
├── CHANGELOG.md
└── LICENSE
```

## 12. Safety, privacy and reliability

- Intended only for applications the operator is authorized to test. Use synthetic users, sandbox payments and disposable resources. Non-loopback origins require explicit opt-in. Do not run financial, inventory or attendance mutations against real production data by default.
- Enforce origin restrictions for top-level navigation, configured API calls, fixture hooks and redirects. Block service workers and unexpected external requests in the default restricted context where feasible; allow explicitly authorized dependency origins for test applications. Document browser controls as best-effort, not a network security sandbox; use an isolated network in high-assurance environments.
- Reject unsupported URL schemes and prevent fixture redirects to unapproved targets. No shell execution or arbitrary JS from scenario files. Treat YAML and target content as untrusted.
- Storage-state files, passwords, API keys and cookies must never be committed to source control or echoed in reports. Include `.gitignore` guidance for auth and artifacts. Redact authorization, cookies, secret query values and sensitive header values; request and response bodies are not captured by default. Screenshots may still contain sensitive UI data; use synthetic fixtures and restrict artifact access.
- Use explicit timeouts, bounded actors/repeats and deterministic cleanup. Default to sequential attempts, no retries of race mutations, no automatic replay of destructive actions.
- No telemetry, remote uploads or external AI requests by default. Reports are generated locally.
- Authenticated sessions may be cloned only from explicitly supplied test state; isolation does not imply distinct user identities.

## 13. Non-functional requirements

| ID | Requirement / proposed release target |
|---|---|
| NFR-01 | Operate locally on Windows, macOS and Linux with Node.js and Chromium installed; Linux CI is required. |
| NFR-02 | Typical MVP scenario: 2 actors, with support for up to 5. Target practical operation on a 16 GB RAM development laptop; measure peak RSS on a documented reference setup before release. No hard memory guarantee without benchmarks. |
| NFR-03 | For a local ready-button demo, target p95 runner dispatch skew <= 50 ms with 2 actors over 100 controlled attempts on documented reference hardware. Treat this as a benchmark goal, not a server-side timing SLA; report observed measurements and limitations. |
| NFR-04 | Fixed seed and scenario produce identical planned offsets; actual execution timing may differ. |
| NFR-05 | No race is released before all actors reach the barrier. Every attempt produces an explicit status and cleanup occurs on normal failure and interruption. |
| NFR-06 | Strict report schema versioning; JSON parseable by machines and evidence paths relative to report root. |
| NFR-07 | Document installation, first-run example, fixture setup, exit codes, common errors and supported agent setup. |
| NFR-08 | No network dependencies beyond approved application endpoints and explicit initial package/browser installation. |

## 14. Demo application and validation strategy

Build a deliberately vulnerable local booking playground and a corrected variant. Use a controlled asynchronous interleaving in the vulnerable handler (both requests observe availability before committing) to demonstrate the bug reliably; use an atomic reservation or equivalent concurrency-safe update in the corrected variant. The playground is only a test fixture, not a production architecture recommendation.

| Test | Expected outcome |
|---|---|
| Vulnerable booking fixture | At least one verified duplicate booking in a controlled repeatable race scenario; report includes committed count > 1. |
| Corrected booking fixture | Exactly one booking per valid attempt across the release regression suite; no confirmed violations. |
| Separate users | Different auth/cookie/storage values remain isolated. |
| Same account in separate sessions | Two distinct browser contexts may use the same identity; duplicate-operation invariant enforced. |
| Delayed/missing actor | No partial release; attempt INCONCLUSIVE. |
| Failed reset or incorrect baseline | No race mutation; attempt INCONCLUSIVE; unsafe repeat stops. |
| Seeded jitter | Identical planned offsets with identical seed. |
| Timing threshold exceeded | Inconclusive unless an independent invariant violation is verified; actual timing preserved. |
| UI success but API count is wrong | FAIL with authoritative API evidence. |
| Locator error or verification outage | INCONCLUSIVE if no independent invariant violation is established. |
| Expected rejection of losing actor | PASS when the full invariant holds. |
| Secret in config / request | Redacted from normal JSON and request metadata; raw artifacts not uploaded. |
| Non-approved external target | Configuration/policy failure before race actions. |
| Interrupt / timeout | Contexts closed and partial report written where possible. |
| CI invocation | Correct exit codes and JSON schema on supported environments. |

Use unit tests for barrier, scheduler, schema, result classification, fixture rules, redaction and target validation; integration tests for Playwright isolation, timing, assertions and vulnerable/fixed playgrounds. Avoid relying on uncontrolled real-world race timing as the only regression test.

## 15. MVP release criteria

The MVP is ready for public release when:

- All P0 functional requirements are implemented and tested; P1 work is not required for launch.
- Vulnerable and corrected playgrounds demonstrate expected behavior with documented reproducible commands.
- Fresh installation and CLI smoke tests pass on the published platform matrix.
- Required repeat/reset, no-partial-release, inconclusive classification and redaction tests pass.
- README includes a quickstart, actual evidence example, scenario reference and known limitations.
- Claude Code, Codex and Cursor installation instructions are tested or their unsupported modes explicitly documented.
- Package name and repository availability are checked; dependency licenses and MIT license choice are verified.
- No unresolved critical security/reliability defects in RaceUI itself.

## 16. Implementation roadmap

| Phase | Deliverable | Dependency |
|---|---|---|
| 1 — Foundation | npm/TypeScript setup, schema, CLI init/validate, local playground | None |
| 2 — Core engine | Context isolation, preparation, readiness barrier, scheduling, cleanup | Phase 1 |
| 3 — Verification | Fixtures, UI/API assertions, timing validity, repeat runner | Phase 2 |
| 4 — Evidence | JSON and terminal reports, redacted request metadata, screenshots, exit codes | Phase 3 |
| 5 — Release | Integration tests, CI matrix, skills, README, npm packaging and examples | Phase 4 |
| After v0.1 | Opt-in trace, static HTML, optional MCP adapter, additional browser engines after validation | Stable core |

Sequence is a development proposal, not a time or staffing commitment. Keep scope small; use existing Playwright functionality instead of reimplementing browser automation.

## 17. Success metrics

Initial product-validation targets (not existing measurements):

- A new user can run the provided demo within 10 minutes after prerequisites are installed.
- The controlled vulnerable fixture demonstrates a real invariant violation, while the fixed fixture passes the defined regression suite.
- At least three documented scenario patterns: double booking, duplicate attendance and lost update.
- At least one end-to-end demonstrated workflow with each of Claude Code, Codex and Cursor, subject to tested compatibility.
- All reports distinguish observed failures from invalid or inconclusive experiments.
- Gather opt-in community feedback through GitHub issues, PRs and stars; no hidden runtime usage tracking.

## 18. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Browser clicks start together but server requests do not | Record actual dispatch/request timing, support stagger/jitter, avoid server-side simultaneity claims. |
| Repeated tests corrupt state or create misleading results | Fresh contexts, fixture reset or unique resources, baseline verification, safe stop on reset failure. |
| False positives from UI toasts or stale data | Prefer authoritative read-only assertions; distinguish UI-only outcomes and allow observation windows. |
| False negatives due to narrow race windows | Repeat, vary timing, preserve seed; never claim absence of defects. |
| Authentication complexity | Reuse Playwright storage state and document UI login steps; no credential vault in MVP. |
| Selector instability or action timeout | Stable test IDs, explicit waits, report execution errors as inconclusive. |
| Secrets in evidence | Redaction, synthetic accounts, local artifacts, opt-in raw traces. |
| Scope creep into full testing framework | Keep one race action per actor per attempt and defer general workflows, cloud, dashboard and MCP. |
| Existing package or similar tool names | Verify branding and package availability before publication; rename if needed. |

## 19. Future possibilities (not committed)

- MCP adapter exposing validation, run and report-reading operations to coding agents.
- Playwright test-runner integration and JavaScript/TypeScript programmatic API.
- Browser-level request gating for selected operations with explicit caveats about altering behavior.
- Multiple race checkpoints per scenario, Firefox/WebKit, richer evidence timeline and JUnit export.

These are optional extensions only if community usage demonstrates need. Do not expand MVP solely to match general QA platforms.

## 20. Proposed product decisions and open questions

The agreed direction is a small open-source UI-driven concurrency testing utility, not a new full QA framework. The following details are proposed implementation decisions and can be adjusted before development: MIT license, TypeScript/Node.js, Playwright Chromium, declarative YAML, 2–5 actors, sequential repeats, optional test fixture endpoints, read-only API assertions, and local evidence.

Open decisions: final package/repository name availability, exact dependency versions, benchmark hardware and results, tool-specific skill installation verification, and whether P1 traces/HTML are needed for first publication. No claim has been made that RaceUI is already implemented or unique across all existing tools.

**Positioning:** RaceUI is a lightweight, agent-friendly concurrency testing toolkit for discovering race conditions through real browser interactions.
