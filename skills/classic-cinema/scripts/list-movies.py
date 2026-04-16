#!/usr/bin/env python3
"""Fetch Classic Cinemas APIs and print today's movie listing.

Usage:
    python3 list-movies.py [--movie QUERY]

Without --movie: prints a numbered listing of all movies showing today (Browse mode).
With --movie: fuzzy-matches QUERY and prints only matching movies with session IDs.

Writes /tmp/cc-sessions.json and /tmp/cc-movies.json as side effects.

Output format (one JSON object per line):
    {"index": 1, "name": "...", "vistaId": "...", "rating": "PG", "runtime": "...",
     "sessions": [{"id": "...", "time": "10:00am", "screen": "Screen 3", "screenNumber": 3, "date": "..."}]}

Exit codes:
    0 — success
    1 — no sessions today / no matches for query
"""

import argparse
import json
import sys
import urllib.request
from datetime import datetime, timezone, timedelta

CINEMA_ID = "0000000002"
BASE_URL = "https://www.classiccinemas.com.au/api"
AEST = timezone(timedelta(hours=10))


def fetch_json(url, dest_path=None):
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req) as resp:
        data = resp.read()
    if dest_path:
        with open(dest_path, "wb") as f:
            f.write(data)
    return json.loads(data)


def format_time(iso_str):
    dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
    dt_local = dt.astimezone(AEST)
    return dt_local.strftime("%-I:%M%p").lower()


def main():
    parser = argparse.ArgumentParser(description="Classic Cinemas listing")
    parser.add_argument("--movie", type=str, default=None, help="Fuzzy match movie name")
    args = parser.parse_args()

    sessions = fetch_json(f"{BASE_URL}/sessions/{CINEMA_ID}", "/tmp/cc-sessions.json")
    movies = fetch_json(f"{BASE_URL}/movies", "/tmp/cc-movies.json")

    today = datetime.now(AEST).strftime("%Y-%m-%d")

    movie_map = {}
    for m in movies:
        vid = m.get("vistaId")
        if vid:
            movie_map[vid] = m

    today_sessions = {}
    for s in sessions:
        if s.get("date", "")[:10] == today:
            mid = s.get("movieId")
            if mid and mid in movie_map:
                today_sessions.setdefault(mid, []).append(s)

    if not today_sessions:
        print("No sessions showing today at Elsternwick", file=sys.stderr)
        sys.exit(1)

    entries = []
    for mid, slist in sorted(today_sessions.items(), key=lambda x: movie_map[x[0]]["name"]):
        m = movie_map[mid]
        rating = m.get("rating", {}).get("id", "?")
        runtime = m.get("runtime", "?")
        sess_list = []
        for s in sorted(slist, key=lambda x: x["date"]):
            sess_list.append({
                "id": s["id"],
                "time": format_time(s["date"]),
                "screen": s.get("screenName", "?"),
                "screenNumber": s.get("screenNumber", 0),
                "date": s["date"],
            })
        trailer = m.get("trailer", "")
        entries.append({
            "name": m["name"],
            "vistaId": mid,
            "rating": rating,
            "runtime": runtime,
            "trailer": f"https://www.youtube.com/watch?v={trailer}" if trailer else None,
            "summary": m.get("summary", ""),
            "headerImage": m.get("headerImage", ""),
            "posterImage": m.get("posterImage", ""),
            "sessions": sess_list,
        })

    if args.movie:
        query = args.movie.lower()
        matched = [e for e in entries if query in e["name"].lower()]
        if not matched:
            print(f"No movies matching '{args.movie}' today", file=sys.stderr)
            # Print full listing to stderr for fallback
            for i, e in enumerate(entries, 1):
                print(f"  {i}. {e['name']}", file=sys.stderr)
            sys.exit(1)
        entries = matched

    for i, e in enumerate(entries, 1):
        e["index"] = i
        print(json.dumps(e))


if __name__ == "__main__":
    main()
