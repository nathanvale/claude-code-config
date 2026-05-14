#!/usr/bin/env python3
"""Parse Classic Cinemas ticket types and build a selection file for fill-ticket.py.

Usage:
    python3 parse-tickets.py --session-id 122890 --spec "1+1"

Fetches ticket types from /tmp/cc-tickets.json (or the API if not cached).
Parses the spec string: positional slots map to Adult, Child, Concession, Senior, Student, Pension.
Writes /tmp/cc-tickets-selected.json and prints a pricing summary as JSON.

Spec format:
    "1+1"     → 1 Adult + 1 Child
    "2"       → 2 Adult
    "1+2"     → 1 Adult + 2 Child
    "1+0+1"   → 1 Adult + 0 Child + 1 Concession

Output (stdout JSON):
    {
        "tickets": [{"type": "Adult", "qty": 1, "price": 2700}, ...],
        "bookingFeeCents": 390,
        "totalCents": 4790,
        "summary": "1x Adult ($27.00) + 1x Child ($17.00) + fees ($3.90) = $47.90"
    }

Exit codes:
    0 — success
    1 — invalid spec or missing data
"""

import argparse
import json
import os
import sys
import urllib.request


CINEMA_ID = "0000000002"
SLOT_ORDER = ["Adult", "Child", "Concession", "Senior", "Student", "Pension"]


def fetch_tickets(session_id):
    """Load tickets from cache or fetch from API."""
    path = "/tmp/cc-tickets.json"
    if not os.path.exists(path):
        url = f"https://www.classiccinemas.com.au/api/sessions/{CINEMA_ID}/{session_id}/tickets"
        try:
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = resp.read()
            with open(path, "wb") as f:
                f.write(data)
        except Exception as e:
            print(f"Failed to fetch tickets: {e}", file=sys.stderr)
            sys.exit(1)

    with open(path) as f:
        return json.load(f)


def parse_spec(spec_str):
    """Parse '1+1' into [(slot_index, qty), ...]."""
    parts = spec_str.strip().split("+")
    result = []
    for i, part in enumerate(parts):
        try:
            qty = int(part.strip())
        except ValueError:
            print(f"Invalid spec part: '{part}' — expected a number", file=sys.stderr)
            sys.exit(1)
        if i >= len(SLOT_ORDER):
            print(f"Too many ticket slots (max {len(SLOT_ORDER)})", file=sys.stderr)
            sys.exit(1)
        if qty > 0:
            result.append((SLOT_ORDER[i], qty))
    return result


def format_price(cents):
    return f"${cents / 100:.2f}"


def main():
    parser = argparse.ArgumentParser(description="Parse ticket spec and build selection")
    parser.add_argument("--session-id", required=True, help="Session ID for ticket fetch")
    parser.add_argument(
        "--spec", required=True,
        help="Ticket spec e.g. '1+1' for 1 adult + 1 child"
    )
    args = parser.parse_args()

    data = fetch_tickets(args.session_id)

    # Build lookup: name -> ticket type (categoryId 2 = public tickets)
    type_lookup = {}
    for t in data.get("ticketTypes", []):
        if t.get("categoryId") == 2:
            type_lookup[t["name"]] = t

    # Parse spec
    selections = parse_spec(args.spec)
    if not selections:
        print("No tickets in spec", file=sys.stderr)
        sys.exit(1)

    tickets = []
    total_cents = 0
    total_fee_cents = 0
    summary_parts = []

    for type_name, qty in selections:
        if type_name not in type_lookup:
            available = sorted(type_lookup.keys())
            print(
                f"Ticket type '{type_name}' not available for this session. "
                f"Available types: {', '.join(available) if available else '(none)'}",
                file=sys.stderr,
            )
            sys.exit(1)
        tt = type_lookup[type_name]
        price = tt["priceInCents"]
        fee = tt["bookingFeeInCents"]
        tickets.append({"type": type_name, "qty": qty, "price": price})
        line_total = price * qty
        total_cents += line_total
        total_fee_cents += fee * qty
        summary_parts.append(f"{qty}x {type_name} ({format_price(line_total)})")

    grand_total = total_cents + total_fee_cents
    summary_parts.append(f"fees ({format_price(total_fee_cents)})")
    summary = " + ".join(summary_parts) + f" = {format_price(grand_total)}"

    # Write selection file for fill-ticket.py
    selected_path = "/tmp/cc-tickets-selected.json"
    with open(selected_path, "w") as f:
        json.dump(tickets, f, indent=2)

    # Print result
    result = {
        "tickets": tickets,
        "bookingFeeCents": total_fee_cents,
        "totalCents": grand_total,
        "summary": summary,
        "selectedFile": selected_path,
    }
    print(json.dumps(result))


if __name__ == "__main__":
    main()
