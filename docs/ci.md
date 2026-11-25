# Running RaceUI in CI

RaceUI is a single CLI with deterministic exit codes, so it works in any CI system (Jenkins, GitLab
CI, Azure Pipelines, Buildkite, CircleCI, GitHub Actions, a cron job...). It never prompts.

## Exit codes

| Code | Meaning | Typical CI action |
|---:|---|---|
| 0 | All attempts PASS | continue |
| 1 | Confirmed invariant violation (FAIL) | block the release |
| 2 | Invalid scenario, bad CLI usage, unapproved target | fix the pipeline/scenario |
| 3 | No confirmed violation but INCONCLUSIVE / not completed | investigate environment; usually block |
| 130 | Interrupted | retry the job |

## Linux runner (generic shell)

```bash
# 1. Install (Node.js 22+)
npm ci                                   # or: npm install -g raceui
npx raceui install-browser --with-deps   # Chromium + system libraries (needs root/sudo)

# 2. Start the application under test (test build with fixture endpoints), then:
export RACEUI_FIXTURE_TOKEN="$CI_SECRET_FIXTURE_TOKEN"   # from your CI secret store

npx raceui validate scenarios/booking.yaml
npx raceui run scenarios/booking.yaml \
  --repeat 20 --seed 42 \
  --output artifacts/raceui \
  --allow-origin https://staging.internal.example.com    # only for approved, non-loopback test targets
status=$?

# 3. Keep artifacts (report.json, report.html, screenshots) as private CI artifacts.
exit $status
```

Without root access, use the official Playwright Docker image, which already contains the browser
dependencies (match the Playwright version in `package-lock.json`):

```bash
docker run --rm --ipc=host -v "$PWD":/work -w /work \
  -e RACEUI_FIXTURE_TOKEN \
  mcr.microsoft.com/playwright:v1.65.1-noble \
  bash -c "npm ci && npx raceui run scenarios/booking.yaml --repeat 20"
```

## Tips

- Use `--json` to capture the report on stdout, or read `artifacts/raceui/<run-id>/report.json`.
  The JSON has `schemaVersion: 1`; parse `status`, `exitCode` and `summary`.
- Use a fixed `--seed` so planned offsets are identical between runs (actual timing still varies).
- `--stop-on-fail` shortens failing pipelines; skipped attempts are reported explicitly.
- Treat artifacts as sensitive: screenshots may show test data. Do not enable `--trace` in shared CI
  unless artifacts are access-controlled (traces are not redacted).
- Loopback targets (`localhost`, `127.0.0.1`) need no flag. Staging origins must be passed with
  `--allow-origin` in the pipeline definition; a scenario file cannot authorize itself.
