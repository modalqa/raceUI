export const INIT_TEMPLATE = `# RaceUI scenario (schema version 1)
# Two users. One resource. Zero room for bugs.
#
# 1. Point baseUrl at a LOCAL or authorized TEST environment (never production).
#    Non-loopback origins must be allowed explicitly: raceui run file.yaml --allow-origin https://staging.example.com
# 2. Give each actor its own session. Optional Playwright storage-state files (relative to this file)
#    are a convenient way to start logged in. Never commit them.
# 3. Prepare each actor up to the moment right before the competing action (prepare must NOT consume the resource).
# 4. Declare the business invariant: UI outcomes and, preferably, an authoritative read-only API check.
# 5. For repeat > 1, configure fixtures.reset (or strategy: unique) and fixtures.baseline.
#
# Validate: raceui validate raceui.yaml
# Run:      raceui run raceui.yaml --repeat 10 --seed 42
#
# Try it against the bundled vulnerable playground:
#   npx raceui-playground --mode vulnerable

version: 1
name: concurrent-seat-booking
baseUrl: http://127.0.0.1:3000

actors:
  - id: user-a
    # storageState: ./auth/user-a.json
    prepare:
      - navigate: /login?user=alice&next=/booking/seat-01
      - waitFor: '[data-testid="confirm-booking"]'
    race:
      click: '[data-testid="confirm-booking"]'

  - id: user-b
    # storageState: ./auth/user-b.json
    prepare:
      - navigate: /login?user=bob&next=/booking/seat-01
      - waitFor: '[data-testid="confirm-booking"]'
    race:
      click: '[data-testid="confirm-booking"]'

fixtures:
  reset:
    method: POST
    path: /test-support/reset
    headers:
      Authorization: 'Bearer \${RACEUI_FIXTURE_TOKEN}'
  baseline:
    get: /test-support/seat-01/booking-count
    headers:
      Authorization: 'Bearer \${RACEUI_FIXTURE_TOKEN}'
    pointer: /count
    equals: 0

timing:
  mode: simultaneous        # simultaneous | staggered (offsetsMs) | jitter (jitterMs)
  maxDispatchSkewMs: 100
  barrierTimeoutMs: 15000
  actionTimeoutMs: 5000
  requestFilter:
    method: POST
    path: /api/bookings

assertions:
  settleMs: 300
  timeoutMs: 3000
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
          Authorization: 'Bearer \${RACEUI_FIXTURE_TOKEN}'
        pointer: /count
        equals: 1

run:
  repeat: 5
  seed: 42
  browser: chromium
  evidence: on-failure      # on-failure | always | none
`;
