# HSB Living Lab source audit — Stage 1

**Audited source:** [Knutsson, HSB Living Lab Fixture-Level Household Water Consumption Dataset (2019–2023), Zenodo version 1.1.0, DOI 10.5281/zenodo.22076411](https://zenodo.org/records/22076411), published 2026-08-24. The initial v4 plan called this “v2”; the plan now uses the record's **1.1.0** version label. The [associated article](https://www.sciencedirect.com/science/article/pii/S0959652626020433) cites the version-family DOI 10.5281/zenodo.18971106. The audited version-specific DOI is pinned here. Licence is **CC BY 4.0**, confirmed independently by the Zenodo Rights section and the archive's README and data dictionary. Attribute Knutsson and the DOI in any reuse.

## Integrity and reproducibility

| File | Verified digest |
|---|---|
| `HSB_Living_Lab_Data_Package.zip` | Zenodo MD5 `1db6a143f39da53710e63c6bb353d5b1`; local MD5 matched. Local SHA-256 `ff766b30d05e65c2477fc929d56a112d5b0775619075daa2bd6dd687c57c7c89` |
| CSV within archive | SHA-256 `e9b8f34245b5cfb2b43d8fe3274056bcc5f3dca0cbf8904a6c4227ddd42d0be8` |
| First 1,000 source rows plus header, byte-identical | SHA-256 `14ee67cb19d5dea4004bc4cf873316db4db028d7cfb4621193741a6aeedf6e4d` at `tools/import-hsb/fixtures/hsb-sample-1000.csv` |

Archive source: `https://zenodo.org/records/22076411/files/HSB_Living_Lab_Data_Package.zip?download=1`. The 6.2 MB ZIP was downloaded locally, and `DATA_DICTIONARY.txt`, `README.txt`, `scripts/anonymize_data.py`, and the semicolon-delimited CSV were read. The full source archive and CSV are not committed. Reproduce the profile with `python3 tools/import-hsb/profile.py /path/to/HSB_Living_Lab_Water_Consumption_Anonymized.csv --out docs/data/hsb-profile.json`. The checked-in JSON is the raw audit output, including all 214 source sensor mappings.

## Source-field map

| Source fields | Audited meaning and handling |
|---|---|
| `timestamp` | UTC timestamp, rounded to nearest 10 minutes for anonymization. A timestamped **event**, not a proven closed interval start/end. Store `event_at` as UTC `timestamptz`; use `Europe/Stockholm` when interpreting local periods later. |
| `date`, `hour`, `day_of_week`, `day_name`, `month`, `year` | Derived UTC calendar features; audit only, not independent measurement or bill boundary. |
| `sensor_id` | Stable anonymized meter ID; 214 distinct. Not unique with timestamp. Maps to one consistent tuple of apartment, cluster, room, room type, channel and fixture across this version. |
| `apartment` | 28 pseudonyms `APT_001`–`APT_028`, plus blank for shared/unattributed rows. A blank is **not** a flat. |
| `cluster_name` | Nine pseudonyms `CL_A`–`CL_I`, plus blank. Do not infer apartment from cluster. |
| `room_number`, `room_type` | Anonymous room and label; 49 rooms and 7 room types. Shared space/bathroom and cleaning/laundry categories occur. |
| `type` | Exactly `cold water consumption` or `hot water consumption`; map to separate cold/hot channels. |
| `attached_to` | Five observed labels: Kitchen tap, Shower, Toilet, Washbasin, Washing machine. Preserve source label. |
| `value` | Positive decimal event volume. **Unit discrepancy:** dictionary says litres with three decimals, but the cleaning script calls its 0.3 threshold m³ and the 652,315 values sum to `3270.789`, matching the published rounded `3,271 m³` only when interpreted as m³. Stage 1 adapter explicitly uses this aggregate-supported m³ interpretation, so `0.001` becomes `1000` mL. This is an inference, not a corrected publisher dictionary. Keep it flagged for source clarification before measured-volume billing claims. |
| `aggregated_value` | Described ambiguously as aggregate/cumulative event or session volume. Not imported as a physical cumulative reading or added to `value`; its full-column sum is not meaningful water usage. |

The source's original `ID` and `aggregated_event_id` were removed by anonymization. The only stable identity for exact replay of this pinned archive is the **CSV physical line number**, saved as `csv:0000002` etc. This identity is scoped by the archive SHA-256 and adapter version. Different archive versions must not be merged by line number. The `row_sha256` contract is now explicitly versioned as `hsb-parsed-fields-json-v1`: SHA-256 of UTF-8 `JSON.stringify` on all 16 parsed string fields in published header order, **not raw CSV bytes**. Stage 2 retained the `hsb-event-1.0.0` adapter and existing stored hashes because the semantics did not change. See decision 002 and the 1,000-row HTTP replay evidence.

## Full-file profile and limits

The CSV has **652,315 rows**, 16 columns, first UTC timestamp `2019-12-31 00:00:00`, last `2023-01-31 14:10:00`. All timestamps land on a 10-minute grid. There are 498,046 rows with an apartment and 154,269 blank-apartment rows; 41,798 rows have blank cluster. There are 152 apartment-mapped sensors and 62 blank-apartment sensors. No sensor changes its location/fixture/channel tuple in this file. The source has 701 repeated `(sensor_id, timestamp)` keys (705 excess rows); 561 of those keys have differing `value` or `aggregated_value`. There are also 140 repeated complete rows (140 excess rows). These are **source rows**, retained with distinct file-line identities; no deduplication is claimed. Per-apartment row counts and every sensor tuple are in `hsb-profile.json`.

All 652,315 `value` fields are positive. The source cleaning script explicitly filters `value <= 0`; the published CSV therefore has **no explicit zero-use rows**. A missing sensor/timestamp row may mean zero use, outage, or filtered data; the file does not carry a per-sensor heartbeat or status mask to distinguish them. The record's 83.9% temporal coverage is a publication-level statistic, not a validated meter-by-meter billing mask. The dictionary calls each row a consumption event and does not define a 10-minute interval boundary. Repeated sensor/timestamp keys further prevent one-row-per-bin assumptions.

**Billing eligibility finding:** 28 apartment pseudonyms are usable for historical event analytics, but **0 apartments and 0 common periods are coverage-valid for measured billing under the v4 invariant**. This is a semantic limit, not a claim that those apartments consumed no water. No common billing window can be certified from this zero-filtered event file, even where rows are present on consecutive grid times. Source-derived totals may be shown only as event-sum analytics with the unit inference and coverage caveat. Stage 3 billing must use the **separate, clearly labeled illustrative test fixture** at `tools/fault-fixtures/billing-demo.json`; it must not merge it with observed HSB rows or invent a physical main meter.

The 1,000-row subset is a byte-for-byte prefix for deterministic importer smoke tests and later small hosting only. It is not a billable cohort or representative performance sample. `docs/data/hsb-import-small.json` records the local import run after execution.
