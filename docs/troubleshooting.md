# Common errors

| Message / symptom | Cause | Fix |
|---|---|---|
| `environment variable ${X} is not set` (exit 2) | A `${X}` placeholder has no value | Export the variable (`export X=...` / `$env:X="..."`) |
| `target origin https://... is not loopback` (exit 2) | Non-local `baseUrl` | Only if authorized: `--allow-origin https://...` |
| `must be a path relative to baseUrl` | Absolute URL in `navigate`/`get`/`path` | Use paths starting with `/` |
| `unrecognized key` | Typo or unsupported option | Check the scenario reference in the README |
| `repeat N requires fixtures.reset ...` | Repeats without a known starting state | Add `fixtures.reset` (or `strategy: unique`) and `fixtures.baseline` |
| `actors a, b share one storageState` | Two actors use the same identity file | Set `sharedIdentity: true` on both if intended |
| `Executable doesn't exist ... ms-playwright` | Chromium not installed | `raceui install-browser` (Linux CI: `--with-deps`) |
| `error while loading shared libraries` (Linux) | Missing browser system libraries | `raceui install-browser --with-deps` as root, or use the Playwright Docker image |
| INCONCLUSIVE: `readiness barrier not reached ... prepare step 2 (waitFor) failed` | A selector never became visible for one actor | Fix the selector/flow; check that actor's screenshot in `attempt-XXX/` |
| INCONCLUSIVE: `race locator matched 2 elements` | Race selector is not unique | Use a stable unique selector (`data-testid`) |
| INCONCLUSIVE: `baseline not satisfied` | Reset did not restore the expected state | Fix the reset endpoint or baseline expectation; the run stops to stay safe |
| INCONCLUSIVE: `timing threshold exceeded` | Actors dispatched further apart than `maxDispatchSkewMs` | Close other heavy processes, reduce actors, or raise the threshold consciously |
| INCONCLUSIVE: `verification unavailable` | API check endpoint failed/timed out | Make sure the read-only endpoint is reachable and returns JSON |
| INCONCLUSIVE: `action error` | The race click/press failed | Check `actionError` in the report; RaceUI never retries race actions |
| FAIL with `ui-outcome-mismatch` | Only visible UI text disagreed | Add an authoritative `api` check to confirm persisted state |
| Everything PASSes but you expected a bug | Race window too narrow | More `--repeat`, `timing.mode: jitter`, or staggered offsets; a PASS is never proof of absence |
| Garbled logo in the terminal | Terminal without truecolor/Unicode | `NO_COLOR=1` or `--no-logo` |
