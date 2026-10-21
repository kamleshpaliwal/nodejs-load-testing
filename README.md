# REST API load testing and correctness framework

A dependency-free Node.js 20+ starter framework for authorized REST API testing. It combines open-loop scenario arrivals, CRUD assertions, basic run-scoped audit verification, SLO evaluation, a local demo API, and JSON/JSONL/HTML run artifacts. It is designed for a local demonstration and staging adapters; it is not a production-grade distributed load generator.

## What existed and implementation plan

The supplied workspace was empty: no Git repository, package manifest, source, tests, or prior run results existed. The project was created as a clean implementation: (1) config and safety validation, (2) deterministic data and CRUD client, (3) local API with idempotency/version/audit, (4) bounded open-loop runner and reports, (5) automated unit and integration checks.

## Quick start

Requirements: Node.js 20 or newer. No `npm install` is needed.

```sh
npm test
npm run demo
# in another terminal:
npm run loadtest -- --config config/example.config.json --seed 12345 --rps 5 --duration 5
```

Or run the demo with `docker compose up --build`. It binds to loopback inside the container and exposes port 3000.

Supported CLI flags: `--config`, `--target`, `--rps` (scenario arrivals per second), `--duration` (seconds), `--concurrency`, `--request-timeout` (ms), `--warmup` (seconds), `--drain-timeout` (ms), `--seed`, `--namespace`, `--allow-non-local`, `--destructive`, and `--no-cleanup`. The current scenario is CRUD and includes deletion, so remote destructive testing is intentionally not implemented. A config can set `destructive`, but remote destructive use is rejected. Non-local targets require explicit `--allow-non-local`; exercise that only with an authorized test system.

Before running, the CLI prints target, scenario arrival rate, duration, concurrency cap, seed, destructive setting, SLOs, and output directory. Credentials can be supplied via `API_TOKEN`; secrets and target query parameters are redacted in the manifest. Redirects are not followed, avoiding credential forwarding to an unapproved host.

## Architecture

- `src/config.js`: config merge, CLI parsing, validation and redaction.
- `src/data.js`: seeded PRNG and deterministic per-scenario input.
- `src/scenario.js`: HTTP request wrapper and CRUD workflow.
- `src/metrics.js`: percentile/aggregate and independent SLO checker.
- `src/assertions.js`: reusable invariant, version and duplicate-record checks.
- `src/cli.js`: fixed-rate open-loop scheduler, artifact writer and verdict handling.
- `demo-api/server.js`: local in-memory demonstration API.
- `test/`: deterministic unit and local integration/race tests.

The engine schedules **scenarios/sec**. Each successful CRUD scenario makes six HTTP requests (create, read, patch, read, delete, then a not-found read). HTTP request rate is counted separately from scenario rate. Concurrent scenarios are bounded; if the cap is reached, an arrival is marked dropped rather than queued. The scheduler therefore reports scheduled, started, completed and dropped counts. No unbounded promise queue is maintained.

This is open-loop scheduling: arrivals do not wait for prior scenarios to finish, so it exposes overload more clearly than a closed-loop client that slows its offered load as response times rise. Arrival delay is measured from the scheduled monotonic timestamp. Scenario latency includes time from scheduled arrival until scenario completion; `serviceDurationMs` measures start-to-completion; each request event records its own request duration. The scheduled-arrival measure reduces coordinated omission in the scenario timing for arrivals the scheduler could schedule. It cannot represent dropped requests as completed latency samples, and host scheduler saturation can still distort the offered profile. This implementation does not claim coordinated omission is eliminated.

The PRNG seed controls test inputs, not operating-system scheduling or response times. Same-seed input data repeats for the same scenario index. Run IDs and runtime timing remain unique/nondeterministic.

## Configuration and SLOs

See `config/example.config.json`. `scenarioRate` is the configured scenario arrival rate. `concurrency` caps outstanding scenarios. `durationSeconds` is the measurement window. `warmupSeconds` is currently recorded in configuration/metadata but no separate warm-up phase is executed; use `durationSeconds` for actual measurement. The scheduler has a distinct drain timeout after measurement.

SLO metrics use completed scenarios in the measurement interval. Error rate is failed completed scenarios / completed scenarios; timeout rate is timed-out completed scenarios / completed scenarios; scenario throughput is completed scenarios / measurement seconds; dropped percentage is dropped scheduled arrivals / scheduled arrivals. p95 uses scenario scheduled-arrival-to-completion times and linear interpolation over sorted observed samples. Missing observations and insufficient sample counts are `NOT_EVALUABLE`; overall SLO is `FAIL` if any threshold fails and otherwise `NOT_EVALUABLE` if a check cannot be evaluated. Exit status is nonzero on failed SLO, correctness, audit, or cleanup. Missing audit evidence is `NOT_VERIFIABLE` and is not represented as a pass, but currently does not itself force nonzero exit.

Runtime memory, event-loop delay/utilization and platform data describe the **load generator process**, not the target server. CPU is not currently collected. Server metrics endpoint exists only in the demo. Percentiles and aggregate summaries are in-memory; request events are written at the end, so very long high-rate runs should be avoided. This implementation has configurable RPS/duration/concurrency caps but only one baseline phase and CRUD scenario today; baseline/load/stress/spike/soak/recovery phase plans and weighted scenario selection remain future work.

## Correctness, concurrency and audit

CRUD checks verify create/read state, PATCH effect, read-after-update, delete and not-found behavior. Failed CRUD steps produce structured assertion evidence. The demo supports idempotency keys: key scope is the in-memory process; same key and same serialized payload replays the stored response, and key reuse with a different payload returns 409. Concurrent duplicate requests are handled synchronously in the single Node process. This `Map` is neither durable nor a distributed atomicity guarantee.

Updates accept `If-Match: "<version>"`; stale versions return 412 and successful mutations increment the version. Audit records include run/operation/resource identifiers, outcome, safe key fingerprint, commit timestamp, versions and a server-side sequence. The client checks run-scoped commit count against completed CRUD workflows. An unavailable audit endpoint yields `NOT_VERIFIABLE`. Production use requires an authoritative audit/database adapter with complete pagination, retention guarantees and a documented operation contract; client logs alone cannot prove commit order.

The in-memory demo is nondurable, single-process and not production-grade. Test endpoints `/__test/audit` and `/__test/metrics`, plus delay/failure injection (`?delay=...` and `?fail=1`), are enabled by default for local use. Set `DEMO_TEST_ENDPOINTS=0` to disable them. Do not deploy this demo as a production API.

## Artifacts

Each execution creates `results/<runId>/` containing `manifest.json`, `events.jsonl`, `summary.json`, `phase-metrics.json`, `thresholds.json`, `assertions.json`, `audit-verification.json`, `errors.json`, and `report.html`. The manifest records the effective redacted config, environment, seed, mode, timing windows and inventory. Request and scenario events are structured JSON. Error output is bounded to the first 100 captured entries. Cleanup tracks IDs returned by this run and sends deletes only for those IDs; cleanup is idempotent and status is recorded. The demo does not expose a final-state inventory by run namespace, so cleanup verification is based on delete responses rather than a database snapshot.

`npm run report -- results/<runId>` prints the saved HTML report source. Open `report.html` in a browser for the rendered report.

## Integrating a staging API

Use a dedicated staging base URL, configure environment-based credentials, and set `--allow-non-local`. Adapt `src/scenario.js` to the target's resource paths, response schema, idempotency contract and conditional update semantics. Add a staging-specific audit adapter that can query by run ID and verify all committed effects, plus a cleanup adapter that proves ownership before deletion. Establish approved rate, duration, concurrency and data-retention limits with the service owner. Never reuse the demo's in-memory audit as production evidence.

## Validation performed in this workspace

Validated with the bundled Node.js v24.19.0 runtime (the system `node` was v16.19.0 and does not meet the Node 20+ requirement). `npm test` passed all 9 unit and integration tests. A fixed-seed baseline run completed 10 scenarios and 60 HTTP requests with 0 dropped arrivals; performance, CRUD correctness, audit verification and cleanup passed. It measured 5 scenarios/sec, 30 HTTP requests/sec and p95 scheduled-to-completion latency of 29.01 ms. A second fixed-seed configuration run was repeated twice; all three generated-data fingerprints matched exactly between runs. An injected slow-target run at 10 scenarios/sec, concurrency 1 and 250 ms per-request delay recorded 9 dropped arrivals out of 10 and failed the configured dropped-arrival SLO (expected nonzero exit). Unit checks also confirmed an intentional invariant mismatch is reported as failed and a breached error-rate SLO returns `FAIL`.

Artifacts for the latest clean 10-scenario run are in `results/run-2026-10-21T08-28-17-138Z-64d9b9/`. All nine documented files were present; the manifest inventory matched, 70 event lines were recorded, all 10 CRUD assertions passed, audit verification found 30 commits for 10 workflows, and cleanup verified 0 remaining resources. The repeatability runs are `results/run-2026-10-21T08-27-29-964Z-a7d947/` and `results/run-2026-10-21T08-27-32-166Z-6f9cac/`. The latest deliberate slow-target SLO failure is in `results/run-2026-10-21T08-28-27-607Z-178eb4/`.

## Known limitations

This is an initial runnable framework rather than a full enterprise load suite. It currently has one CRUD workflow, one measurement phase, no weighted scenario registry, no retry engine, no response-schema DSL, no authentication scheme beyond bearer token/header pass-through, no durable test-data registry, no authoritative database adapter, no server-side CPU/memory sampler, no external load-generator coordination, and no signal-driven graceful-cancellation cleanup. The deliberate slow-target test is an actual local CLI run, but a larger soak/stress qualification and production staging adapter are still required before capacity sign-off.
