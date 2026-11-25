# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses semantic versioning.

## [0.1.0] - 2026-11-25

### Added (PRD completion)
- FR-15: opt-in Playwright traces per actor (`run.trace` / `--trace off|on-failure|always`) with an
  explicit unredacted-data warning; traces stay in the local run directory.
- FR-16: static offline `report.html` written next to `report.json` (no server, no scripts, strict
  CSP) and `raceui report <report.json>` to regenerate it.
- `raceui install-skill --agent claude|codex|cursor [--global]` installs `SKILL.md` into the agent's
  skill directory. Verified: Claude Code CLI discovers the installed skill (headless check).
- Optional `label` on checks for PRD-style output ("Expected committed bookings: 1").
- Report assertions now carry `expected` as the plain value for `equals` (PRD contract) plus the
  full `comparison` object.
- Explicit `sharedIdentity: true` is required when actors share one storage-state file (FR-02).
- Terminal header (version, scenario, actors, attempts, seed) is printed before the attempts.
- Docs: fixture setup, CI usage (any CI system, no workflow file shipped), troubleshooting,
  benchmarks. Scripts: `npm run bench` (NFR-02/03) and `npm run licenses`.
- More integration tests: action error, timing threshold, storage-state isolation, shared identity,
  secret redaction, traces/HTML, CLI exit-code/JSON contract, `report` and `install-skill`.

### Added
- `raceui` CLI with `init`, `validate`, `run` and `install-browser` commands, documented exit codes
  (0/1/2/3/130) and a terminal logo banner rendered from `assets/raceui-logo.png`.
- Strict YAML scenario format (schema version 1) validated with Zod: unknown keys, duplicate actors,
  missing references, unsupported actions, absolute URLs, limits and unresolved `${VAR}` placeholders
  are rejected before any browser starts.
- Race engine: isolated Playwright BrowserContext per actor, parallel preparation, locator readiness
  check, readiness barrier with timeout (no partial release), simultaneous / staggered / seeded-jitter
  scheduling, one non-retried race action per actor, sequential repeats with fresh contexts.
- Fixture lifecycle: optional setup hook, per-attempt reset hook or unique resources
  (`${RUN_ID}`, `${ATTEMPT}`, `${RESOURCE_ID}`), baseline verification and safe stop.
- Assertions: aggregate and per-actor visible-text UI checks; read-only API checks with JSON Pointer,
  typed `equals` / `notEquals` / `min` / `max` and bounded polling.
- PASS / FAIL / INCONCLUSIVE classification with UI-only failure labeling and timing-quality checks.
- Versioned JSON report, screenshots, sanitized request metadata and per-actor timing evidence.
- Target-origin policy (loopback by default, `--allow-origin` for others), request blocking,
  service-worker blocking, no redirects for fixture/API calls, secret redaction.
- Vulnerable/fixed playground (`raceui-playground`) with booking, attendance and lost-update flows.
- Examples, Agent Skill (`skills/raceui/SKILL.md`), unit and integration tests.
