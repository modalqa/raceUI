# Benchmarks (NFR-02 / NFR-03)

Reproduce with `npm run build && npm run bench`. The script ([scripts/benchmark.mjs](../scripts/benchmark.mjs))
starts the bundled playground in `fixed` mode (a local ready-button demo), then runs:

1. **Dispatch skew:** 2 actors × 100 attempts, simultaneous mode.
2. **Memory:** 5 actors × 20 attempts; samples runner RSS and the summed RSS of all Playwright
   Chromium processes every ~300 ms and reports the peaks.

These are measurements on one machine, not guarantees or server-side timing SLAs.

## Reference run (2026-11-25)

Machine: Windows 11 (10.0.26200, x64), Intel Core i5-8350U @ 1.70 GHz (4 cores / 8 threads),
16 GB RAM, Node v22.16.0, Chromium 159.0.8154.6 (headless), nothing else running.

| Run | Actors | Attempts | PASS | Skew p50 | Skew p95 | Skew max | Peak runner RSS | Peak Chromium RSS | Peak total | Duration |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| skew-2-actors | 2 | 100 | 100 | 0.22 ms | 0.45 ms | 0.81 ms | 129 MB | 366 MB | 495 MB | 351 s |
| memory-5-actors | 5 | 20 | 20 | 0.72 ms | 1.33 ms | 1.36 ms | 132 MB | 611 MB | 743 MB | 79 s |

- **NFR-03** (p95 runner dispatch skew ≤ 50 ms, 2 actors, 100 controlled attempts): **met** (0.45 ms).
- **NFR-02** (practical on a 16 GB laptop, up to 5 actors): peak ≈ 0.75 GB total RSS with 5 actors.

## What "dispatch skew" means

`dispatchSkewMs = max(dispatchMs) − min(dispatchMs)`: the spread of the moments the runner *issued*
each actor's race action after barrier release. Playwright actionability checks, browser scheduling
and the network add latency afterwards; in the reports the target requests typically start
~50–150 ms after dispatch and a few ms apart from each other. See each attempt's `targetRequest.startMs`
for the browser-observed request timing. Neither value is a server receive time.
