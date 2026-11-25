# Security policy

## Intended use

RaceUI deliberately sends competing, state-changing requests through real browsers. Use it **only**
against applications and environments you are authorized to test, with synthetic users, sandbox
payments and disposable data. Do not run financial, inventory or attendance mutations against real
production data.

## Built-in safeguards

- **Target-origin policy.** Loopback origins (`localhost`, `127.0.0.0/8`, `::1`, `*.localhost`) are
  allowed by default. Every other origin must be authorized at invocation with
  `--allow-origin <origin>`; a scenario file cannot grant itself authorization. Only `http(s)` is
  supported, and every scenario path must be relative to `baseUrl`.
- **Browser restrictions (best effort).** Requests to unapproved origins are aborted, service workers
  are blocked and downloads are disabled. This is not a network security sandbox; use an isolated
  network for high-assurance environments.
- **Fixture and API calls** never follow redirects and are limited to approved origins.
- **No code execution from YAML.** Scenarios are declarative; no shell commands, raw SQL or
  arbitrary JavaScript.
- **Secrets.** Use `${ENV_VAR}` placeholders; unresolved variables are configuration errors.
  Resolved values, authorization/cookie/token headers and sensitive query parameters are redacted
  from terminal output, `report.json` and `requests.json`. Request and response bodies are not
  captured.
- **Bounded execution.** 2–5 actors, at most 100 sequential attempts, explicit timeouts, no retries
  of race mutations, deterministic cleanup on failure and interruption.
- **Local only.** No telemetry, uploads or external AI requests.

## Your responsibilities

- Never commit Playwright storage-state files, credentials or `artifacts/`.
- Screenshots can contain sensitive UI data. Keep artifacts private and use synthetic fixtures.
- Review scenarios written by coding agents before running them against shared environments.

## Reporting a vulnerability

Please report vulnerabilities in RaceUI itself privately through
[GitHub Security Advisories](https://github.com/modalqa/raceUI/security/advisories/new) rather than
public issues. Include affected version, reproduction steps and impact. We aim to acknowledge
reports within 5 business days.
