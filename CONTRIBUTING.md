# Contributing to RaceUI

Thanks for helping! RaceUI intentionally stays small: a focused concurrency-testing utility, not a
general QA framework. Please open an issue to discuss larger features before sending a PR.

## Setup

```bash
npm install
npx playwright install chromium     # or: node dist/cli/index.js install-browser (after build)
npm run build
npm test                            # unit tests
npm run test:integration            # browser tests against the playground
```

Node.js 22+ is required.

## Guidelines

- TypeScript strict mode; no new runtime dependencies without discussion.
- Keep the scenario format declarative. No arbitrary code execution from YAML.
- Never weaken safety defaults (origin policy, redaction, no retries of race mutations, bounded limits).
- Report facts: new result logic must keep PASS / FAIL / INCONCLUSIVE semantics from the README.
- Add unit tests for engine/schema/security logic and an integration test when behavior touches the
  browser. Do not rely on uncontrolled real-world race timing as the only regression test — use the
  playground's controlled interleaving.
- Update `README.md`, `skills/raceui/SKILL.md` and `CHANGELOG.md` when user-facing behavior changes.
- If you change `assets/raceui-logo.png`, regenerate the terminal logo with `npm run logo`
  (requires Python 3 and Pillow).

## Commit and PR checklist

- [ ] `npm run typecheck` passes
- [ ] `npm test` and `npm run test:integration` pass
- [ ] Docs and changelog updated
