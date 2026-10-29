# Stage 2 historical report repair — 2026-10-30

The selected modular baseline and final raw JSON files were preserved byte for byte. Their recorded module paths use the former `/Users/harsh/Projects/Smart-Water-Sub-Meter-Platform` root. The exact modular-final `ingest.ts` was recovered by reversing later Stage 3/4 route and middleware composition additions; its SHA-256 matches the saved executed module hash. The current server composer remains unchanged and was not benchmarked here.

| Artifact | SHA-256 |
|---|---|
| `tools/bench/final-source-stage2-modular/ingest.ts` | `0c8841f72353b41b5a12fb7dd1f7dd99d8a6a7dd3882e3f7077e95fd3f0d3daa` |
| `apps/server/src/ingest.ts` at repair time, unmodified | `32d267dcc9bfbaaf0851c397f65e8b851496b842248e90727a2bf3f101149239` |
| `tools/bench/results/stage2-http-baseline-modular-2026-10-28.json` | `b3d97b1fc696abd9c585f34ad8442a0583b67e4b39b48f8a642749e88eb20f96` |
| `tools/bench/results/stage2-http-final-modular-2026-10-28.json` | `dbc2f3aabfd637762693cb0735d5d1008d32c70e772fce018e66d970337a188b` |

The default report command validates both recorded historical module paths, the preserved baseline and final source hashes, all 13 checksum-pinned inputs after relocation to this checkout, equal benchmark scenario and machine metadata, distinct persistence modes, and replay/conflict results. Three negative probes against temporary copies were rejected. No raw JSON was edited for these probes.

```text
node --import tsx tools/bench/report.ts
Wrote RESULTS.md from selected raw results; throughput ratio 5.57x
exit 0

CI=true npm run verify
exit 0; lint, TypeScript, database grant check, 29/29 Vitest tests in 6 files, benchmark mode check, builds, 2/2 Playwright flows

wrong historical module path: rejected=True, exit=1
wrong final source SHA: rejected=True, exit=1
wrong matched pinned input SHA: rejected=True, exit=1
RESULTS.md unchanged after rejection probes=True
```

The verification transcript is [stage2-evidence-repair-verify-2026-10-30.txt](stage2-evidence-repair-verify-2026-10-30.txt). Verification used the preserved original local PostgreSQL Docker volume and local credentials from the ignored `.env.backup-before-hosted-samples`; it did not target hosted Supabase. The regenerated [RESULTS.md](../../RESULTS.md), SHA-256 `f77c87fd80217a133eca19e25e7ac7aa1160905df9beaaf9361c44172a93e119`, reports the saved **historical local** 5.57× median throughput ratio; this repair did not create a new measurement. Its Stage 3/4 tail matched `HEAD:RESULTS.md` byte for byte, SHA-256 `94c323d5686e40474b01024417beb79ab393bcd27cee`. Stage 4 deployed services and evidence were not changed.
