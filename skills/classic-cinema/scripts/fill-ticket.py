#!/usr/bin/env python3
"""Fill the Classic Cinemas ticket email template with booking data.

Usage:
    python3 fill-ticket.py \
        --movie-title "The Magic Faraway Tree" \
        --session-datetime "Thu 10 Apr, 10:00AM" \
        --screen "Screen 3" \
        --seats "M10, M11" \
        --tickets-file /tmp/cc-tickets.json \
        --booking-fee 390 \
        --total 4790 \
        --poster-url "https://movingstory-prod.imgix.net/..."

Outputs the path to the filled HTML file on stdout.
Tickets file format: [{"type": "Adult", "qty": 1, "price": 2700}, ...]
Prices are in cents.
"""

import argparse
import html
import json
import os
import time


BARCODE_URL = (
    "https://ci3.googleusercontent.com/meips/ADKq_NaPR1UO0ABCDdjEmZOs7Nnk"
    "HZe3ZB9YpKHGLyNCZXD0FH7h5UZJtQMgCD1Mn6jiareUCWODOHBZEfc1cWLPEXox"
    "FYlSTfxxbYlc9PY9F8A=s0-d-e1-ft#https://www.classiccinemas.com.au"
    "/api/barcode/WHRT69C.jpg"
)


def format_price(cents):
    return f"${cents / 100:.2f}"


def format_ticket_type(name):
    """ADULT -> Adult Ticket, CHILD -> Child Ticket, etc."""
    return name.strip().capitalize() + " Ticket"


def build_ticket_lines(tickets):
    lines = []
    for t in tickets:
        ttype = html.escape(format_ticket_type(t["type"]))
        qty = t["qty"]
        lines.append(
            '                                                                <tr>\n'
            '                                                                    <td\n'
            '                                                                            style="font-family: antwerp, sans-serif; font-size: 16px; line-height: 24px; color: #000000;">\n'
            f'                                                                    <span class="outlook-body-font">{ttype} x {qty}</span>\n'
            '                                                                    </td>\n'
            '                                                                </tr>'
        )
    return "\n".join(lines)


def build_invoice_lines(tickets):
    lines = []
    for t in tickets:
        desc = html.escape(f"{format_ticket_type(t['type'])} x {t['qty']}")
        price = html.escape(format_price(t["price"] * t["qty"]))
        lines.append(
            '                    <tr>\n'
            '                        <td\n'
            '                                style="font-family: antwerp, sans-serif; font-size: 14px; line-height: 14px; color: #414141;">\n'
            f'                            <span class="outlook-body-font">{desc}</span>\n'
            '                        </td>\n'
            '                        <td style="font-family: antwerp, sans-serif; font-size: 14px; line-height: 14px; color: #414141; text-align: right;">\n'
            f'                            <span class="outlook-body-font">{price}</span>\n'
            '                        </td>\n'
            '                    </tr>\n'
            '                    <tr class="no-print">\n'
            '                        <td colspan="2" style="font-size: 0; padding-top: 2px; padding-bottom: 2px;">\n'
            '                            <p style="width: 100%; border-top: dashed 1px #000000; font-size: 1;">\n'
            '                                &nbsp;</p>\n'
            '                        </td>\n'
            '                    </tr>'
        )
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(
        description="Fill Classic Cinemas ticket email template"
    )
    parser.add_argument("--movie-title", required=True)
    parser.add_argument("--session-datetime", required=True)
    parser.add_argument("--screen", required=True)
    parser.add_argument("--seats", required=True)
    parser.add_argument(
        "--tickets-file", required=True,
        help="Path to JSON file with ticket selections"
    )
    parser.add_argument("--booking-fee", required=True, type=int, help="In cents")
    parser.add_argument("--total", required=True, type=int, help="In cents")
    parser.add_argument("--poster-url", required=True)
    parser.add_argument("--customer-name", default="Nathan")
    args = parser.parse_args()

    # Load tickets
    with open(args.tickets_file) as f:
        tickets = json.load(f)

    # Load template (relative to this script's directory)
    script_dir = os.path.dirname(os.path.abspath(__file__))
    template_path = os.path.join(
        script_dir, "..", "references", "assets", "ticket-template.html"
    )
    with open(template_path) as f:
        tpl = f.read()

    # Build generated HTML blocks
    ticket_lines = build_ticket_lines(tickets)
    invoice_lines = build_invoice_lines(tickets)

    # Substitute all 13 placeholders
    result = tpl
    result = result.replace("{{CUSTOMER_NAME}}", html.escape(args.customer_name))
    result = result.replace("{{MOVIE_TITLE}}", html.escape(args.movie_title))
    result = result.replace("{{MOVIE_IMAGE_URL}}", args.poster_url)
    result = result.replace("{{SESSION_DATE_TIME}}", html.escape(args.session_datetime))
    result = result.replace("{{SCREEN_NUMBER}}", html.escape(args.screen))
    result = result.replace("{{SEATS}}", html.escape(args.seats))
    result = result.replace("{{BARCODE_URL}}", BARCODE_URL)
    result = result.replace("{{WEB_VIEW_URL}}", "#")
    result = result.replace("{{BOOKING_NUMBER}}", html.escape("N/A"))
    result = result.replace("{{BOOKING_FEE}}", html.escape(format_price(args.booking_fee)))
    result = result.replace("{{TOTAL_AMOUNT}}", html.escape(format_price(args.total)))
    result = result.replace("{{TICKET_LINES}}", ticket_lines)
    result = result.replace("{{INVOICE_LINES}}", invoice_lines)

    # Write output
    ts = int(time.time())
    out_path = f"/tmp/classic-cinema-ticket-{ts}.html"
    with open(out_path, "w") as f:
        f.write(result)

    print(out_path)


if __name__ == "__main__":
    main()
