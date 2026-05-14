#!/usr/bin/env python3
"""Calculate seat availability from Classic Cinemas seatmap JSON files.

Usage:
    python3 check-availability.py --session-ids 122899,122893,122898

Auto-fetches seatmap from the API if /tmp/cc-seatmap-{sid}.json doesn't exist.
Prints one JSON object per line with availability stats.

Output format (one JSON object per line):
    {"sid": 122899, "screen": "Screen 10", "available": 78, "total": 80, "pct": 98}

Exit codes:
    0 — success (at least one session processed)
    1 — no session IDs provided or no seatmap files found
"""

import argparse
import json
import os
import sys
import urllib.request


def calc_availability(seatmap):
    """Count available and total seats from a seatmap response."""
    screen = ""
    areas = seatmap.get("areas", [])
    if areas:
        screen = areas[0].get("name", "")

    total = 0
    unavail = 0
    for row in seatmap.get("rows", []):
        for seat in row.get("seats", []):
            if seat.get("typeId") == "gap":
                continue
            total += 1
            if seat.get("sold") or seat.get("unavailable"):
                unavail += 1

    available = total - unavail
    pct = round(available / total * 100) if total else 0
    return {"screen": screen, "available": available, "total": total, "pct": pct}


def main():
    parser = argparse.ArgumentParser(description="Check seat availability")
    parser.add_argument(
        "--session-ids",
        type=str,
        required=True,
        help="Comma-separated session IDs (e.g. 122899,122893,122898)",
    )
    args = parser.parse_args()

    sids = [s.strip() for s in args.session_ids.split(",") if s.strip()]
    if not sids:
        print("No session IDs provided", file=sys.stderr)
        sys.exit(1)

    processed = 0
    for sid in sids:
        path = f"/tmp/cc-seatmap-{sid}.json"

        # Auto-fetch seatmap from API if file doesn't exist
        if not os.path.exists(path):
            url = f"https://www.classiccinemas.com.au/api/sessions/0000000002/{sid}/seating-map"
            try:
                req = urllib.request.Request(url)
                with urllib.request.urlopen(req, timeout=15) as resp:
                    data = resp.read()
                with open(path, "wb") as wf:
                    wf.write(data)
            except Exception as e:
                print(f"Failed to fetch seatmap for session {sid}: {e}", file=sys.stderr)
                continue

        try:
            with open(path) as f:
                seatmap = json.load(f)
        except FileNotFoundError:
            print(f"Seatmap file not found: {path}", file=sys.stderr)
            continue
        except json.JSONDecodeError:
            print(f"Invalid JSON in seatmap file: {path}", file=sys.stderr)
            continue

        result = calc_availability(seatmap)
        result["sid"] = int(sid)
        print(json.dumps(result))
        processed += 1

    if processed == 0:
        print("No seatmap files could be processed", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
