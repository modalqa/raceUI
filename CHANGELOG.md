# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses semantic versioning.

## [0.1.0] - 2026-11-25

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
