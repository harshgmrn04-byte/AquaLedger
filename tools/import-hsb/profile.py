#!/usr/bin/env python3
"""Profile the unmodified HSB CSV; output is evidence, not billing coverage."""
import argparse
import csv
import json
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path


def profile(path: Path) -> dict:
    counts = Counter()
    distinct = defaultdict(set)
    nulls = Counter()
    sensor_map = defaultdict(set)
    natural_keys = Counter()
    full_rows = Counter()
    first = last = None
    with path.open(newline="", encoding="utf-8") as file:
        reader = csv.DictReader(file, delimiter=";")
        columns = reader.fieldnames
        for row in reader:
            counts["rows"] += 1
            stamp = datetime.strptime(row["timestamp"], "%Y-%m-%d %H:%M:%S")
            first = stamp if first is None or stamp < first else first
            last = stamp if last is None or stamp > last else last
            for key, value in row.items():
                if value == "" or value.lower() == "nan":
                    nulls[key] += 1
            for key in ("sensor_id", "apartment", "cluster_name", "room_number", "room_type", "type", "attached_to"):
                distinct[key].add(row[key])
            sensor_map[row["sensor_id"]].add((row["apartment"], row["cluster_name"], row["room_number"], row["room_type"], row["type"], row["attached_to"]))
            natural_keys[(row["sensor_id"], row["timestamp"])] += 1
            full_rows[tuple(row.values())] += 1
            counts["non_positive_value" if float(row["value"]) <= 0 else "positive_value"] += 1
            counts["timestamp_on_ten_minute_grid" if stamp.minute % 10 == 0 and stamp.second == 0 else "timestamp_off_grid"] += 1
            counts["apartment_missing" if row["apartment"] in ("", "nan", "NaN") else "apartment_present"] += 1
            counts[f"year_{stamp.year}"] += 1
    return {
        "columns": columns,
        "counts": dict(counts),
        "first_timestamp_naive_utc_per_dictionary": first.isoformat(sep=" "),
        "last_timestamp_naive_utc_per_dictionary": last.isoformat(sep=" "),
        "nulls": dict(nulls),
        "distinct_counts": {k: len(v) for k, v in distinct.items()},
        "distinct_values": {k: sorted(v) for k, v in distinct.items() if k not in ("sensor_id", "room_number")},
        "sensors_with_multiple_location_or_fixture_tuples": sum(len(v) > 1 for v in sensor_map.values()),
        "sensor_mapping": {k: [list(x) for x in sorted(v)] for k, v in sorted(sensor_map.items())},
        "natural_sensor_timestamp_keys_repeated": sum(v > 1 for v in natural_keys.values()),
        "natural_sensor_timestamp_excess_rows": sum(v - 1 for v in natural_keys.values()),
        "exact_full_rows_repeated": sum(v > 1 for v in full_rows.values()),
        "exact_full_row_excess_rows": sum(v - 1 for v in full_rows.values()),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("csv", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    result = profile(args.csv)
    output = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(output)
    else:
        print(output)
