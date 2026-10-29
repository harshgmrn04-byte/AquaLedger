# Stage 2 HTTP benchmark — corrected evidence

The original `results/stage2-http-baseline.json` and `results/stage2-http-final.json` are preserved. The old `http.ts` imported `apps/server/src/ingest.ts` for both modes and changed only the reported SHA. Their 6.02× comparison was invalid and is withdrawn.

For a new run, the corrected harness dynamically imports `tools/bench/baseline-source/ingest.ts` for `baseline` and `apps/server/src/ingest.ts` for `final`. `mode.ts` checks the real path, frozen baseline SHA, and implementation signatures before the server starts. `mode-check.ts` verifies both distinct imports and rejects deliberately swapped paths. Each raw result records the path and SHA of the module actually executed. The harness refuses to overwrite an existing raw result.

The original corrected final run predates the server module split. Its exact executed bytes, SHA-256 `64707f3abc1b2ea1cebf3e07b131f511aa163fe521df380f037ba4c3b56505d2`, are preserved at `tools/bench/final-source-stage2/ingest.ts`. The later [modular baseline](results/stage2-http-baseline-modular-2026-10-28.json) and [modular final](results/stage2-http-final-modular-2026-10-28.json) are also **historical**. The modular final's exact `ingest.ts` bytes, SHA-256 `0c8841f72353b41b5a12fb7dd1f7dd99d8a6a7dd3882e3f7077e95fd3f0d3daa`, are preserved at `tools/bench/final-source-stage2-modular/ingest.ts`. This snapshot was recovered by reversing the later billing, source-analytics, CORS, and demo composition additions; its byte-for-byte hash matches the unchanged raw JSON. The current server composer is not the measured source. `mode.ts` still pins the current router, controller, and batched persistence sources for future benchmark runs. Earlier raw JSON is untouched.

The frozen baseline adapter and migration 003 match the current files byte for byte. The harness pins and verifies their checksums, the built shared adapter, shared schema, migration 001/002/003 source files, and the audited sensor profile. It also checks that all three migrations are recorded as applied in the isolated benchmark database. Build the shared package before running the benchmark, so its `dist` adapter is the checked version.

Each corrected pair uses the same checksum-verified HSB 1.1.0 CSV, HTTP payload, 500-event batch size, concurrency 4, host, and clean database reset before every warm-up and measured run. Each path has one warm-up and five measured 10,000-event runs, with all 20 request latencies retained per run. Each also includes a separate full replay and changed-key conflict probe. `report.ts` checks the recorded absolute paths under the former repository root, maps pinned input paths into this checkout, verifies every saved input hash and the exact preserved final-source hash, and rejects mismatched modes, scenario, machine metadata, or replay/conflict results before generating the Stage 2 section of `RESULTS.md`. It preserves the Stage 3/4 sections.

Configure local database passwords in ignored `.env`. Extract the verified HSB CSV outside Git and set `HSB_CSV_PATH` to its absolute path. The recorded repair used `/private/tmp/hsb-stage2/HSB_Living_Lab_Water_Consumption_Anonymized.csv`, whose SHA-256 was `e9b8f34245b5cfb2b43d8fe3274056bcc5f3dca0cbf8904a6c4227ddd42d0be8`.

```sh
npm run build --workspace=@water/shared
npm run bench:check
docker compose up -d --wait
POSTGRES_DB=water_metering_bench npm run db:setup
POSTGRES_DB=water_metering_bench npm run db:migrate
HSB_CSV_PATH=/private/tmp/hsb-stage2/HSB_Living_Lab_Water_Consumption_Anonymized.csv node --import tsx tools/bench/http.ts baseline tools/bench/results/stage2-http-baseline-npm-rerun.json
HSB_CSV_PATH=/private/tmp/hsb-stage2/HSB_Living_Lab_Water_Consumption_Anonymized.csv node --import tsx tools/bench/http.ts final tools/bench/results/stage2-http-final-npm-rerun.json
npm run verify
```

Use fresh output filenames for each repetition; the example `npm-rerun` files may already exist after your first run. To regenerate `RESULTS.md` from a chosen historical pair, run `node --import tsx tools/bench/report.ts <baseline.json> <final.json>`; with no arguments it selects the modular pair. The old raw files remain available to audit the original mistake. No Git commit existed when the saved runs were measured, so their JSON records a null Git revision and the executed module SHA instead. The measured historical source is preserved even though the repository now has commits.

The pre-refactor corrected raw JSON was measured before the package-manager migration and retains the exact pnpm commands used then. The modular pair was measured with npm and is the **historical** Stage 2 comparison selected in `RESULTS.md`; it does not measure the Stage 4 server composer or deployed service.
