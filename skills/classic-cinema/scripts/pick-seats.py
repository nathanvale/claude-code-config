#!/usr/bin/env python3
"""Auto-select the best adjacent seats in a cinema zone.

Usage:
    python3 pick-seats.py --seatmap-file /tmp/cc-seatmap.json --zone middle --count 2

Zones are computed dynamically from the seating map rows (split into thirds).
Seats are scored by proximity to the center of the zone and center of the row.

Exit codes:
    0 — success, prints seat codes to stdout (e.g. "F7, F8")
    1 — no adjacent seats found in any zone
"""

import argparse
import json
import sys


def load_seatmap(path):
    with open(path) as f:
        data = json.load(f)
    return data if isinstance(data, list) else data.get("rows", [])


def get_valid_rows(rows):
    """Filter out gap-only rows (rows where all seats are gaps)."""
    valid = []
    for row in rows:
        seats = row.get("seats", [])
        has_real_seat = any(
            s.get("typeId", "") not in ("gap", "") for s in seats
        )
        if has_real_seat and row.get("name", "").strip():
            valid.append(row)
    return valid


def split_zones(rows):
    """Split rows into Front / Middle / Back thirds."""
    n = len(rows)
    if n == 0:
        return [], [], []
    third = max(1, n // 3)
    front = rows[:third]
    back = rows[n - third:]
    middle = rows[third:n - third] if n > 2 else rows
    # Ensure middle is non-empty
    if not middle:
        middle = rows
    return front, middle, back


def available_seats(row):
    """Return list of available standard seats as (index, name)."""
    result = []
    for i, seat in enumerate(row.get("seats", [])):
        type_id = seat.get("typeId", "standard")
        if type_id in ("gap", "wheelchair", "companion"):
            continue
        if seat.get("sold") or seat.get("unavailable"):
            continue
        result.append((i, seat.get("name", f"{row['name']}{i+1}")))
    return result


def find_adjacent_runs(seats, count):
    """Find all contiguous runs of `count` adjacent seats.

    Returns list of runs, where each run is [(index, name), ...].
    Adjacent means consecutive indices in the seat list.
    """
    if len(seats) < count:
        return []
    runs = []
    for start in range(len(seats) - count + 1):
        run = seats[start:start + count]
        # Check indices are consecutive
        indices = [s[0] for s in run]
        if all(indices[j+1] - indices[j] == 1 for j in range(len(indices)-1)):
            runs.append(run)
    return runs


def score_run(run, row_total_seats):
    """Score a run by distance from horizontal center. Lower is better."""
    center = (row_total_seats - 1) / 2.0
    avg_idx = sum(s[0] for s in run) / len(run)
    return abs(avg_idx - center)


def pick_seats(rows, zone_name, count):
    """Pick the best `count` adjacent seats in the given zone.

    Returns (seat_codes, zone_used) or (None, None) if impossible.
    """
    valid_rows = get_valid_rows(rows)
    front, middle, back = split_zones(valid_rows)

    zone_map = {
        "front": front,
        "middle": middle,
        "back": back,
        "surprise": middle,
    }

    # Try the requested zone first, then expand to adjacent zones
    zone_order = {
        "front": ["front", "middle", "back"],
        "middle": ["middle", "front", "back"],
        "back": ["back", "middle", "front"],
        "surprise": ["middle", "front", "back"],
    }

    for try_zone in zone_order.get(zone_name, ["middle", "front", "back"]):
        zone_rows = zone_map.get(try_zone, middle)
        if not zone_rows:
            continue

        # Sort zone rows by proximity to center of zone (prefer middle rows)
        zone_center = (len(zone_rows) - 1) / 2.0
        sorted_rows = sorted(
            enumerate(zone_rows),
            key=lambda x: abs(x[0] - zone_center)
        )

        best_run = None
        best_score = float("inf")

        for _, row in sorted_rows:
            seats = available_seats(row)
            runs = find_adjacent_runs(seats, count)
            total_seats = len(row.get("seats", []))
            for run in runs:
                s = score_run(run, total_seats)
                if s < best_score:
                    best_score = s
                    best_run = run

        if best_run:
            codes = [s[1] for s in best_run]
            return codes, try_zone

    return None, None


def main():
    parser = argparse.ArgumentParser(
        description="Auto-select best adjacent cinema seats in a zone"
    )
    parser.add_argument(
        "--seatmap-file", required=True,
        help="Path to seating map JSON file"
    )
    parser.add_argument(
        "--zone", required=True,
        choices=["front", "middle", "back", "surprise"],
        help="Preferred seating zone"
    )
    parser.add_argument(
        "--count", required=True, type=int,
        help="Number of adjacent seats needed"
    )
    args = parser.parse_args()

    rows = load_seatmap(args.seatmap_file)
    if not rows:
        print("Error: empty or invalid seating map", file=sys.stderr)
        sys.exit(1)

    codes, zone_used = pick_seats(rows, args.zone, args.count)
    if codes is None:
        print(
            f"Error: no {args.count} adjacent seats found in any zone",
            file=sys.stderr
        )
        sys.exit(1)

    print(", ".join(codes))
    if zone_used != args.zone and args.zone != "surprise":
        print(
            f"Note: expanded from {args.zone} to {zone_used}",
            file=sys.stderr
        )


if __name__ == "__main__":
    main()
