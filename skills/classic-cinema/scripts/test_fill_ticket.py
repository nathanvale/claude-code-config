#!/usr/bin/env python3
"""Regression tests for fill-ticket.py — poster URL and datetime formatting.

Run: cd scripts && python3 test_fill_ticket.py
"""

import importlib.util
import os
import unittest

# fill-ticket.py has a hyphen so can't be imported normally
_spec = importlib.util.spec_from_file_location(
    "fill_ticket",
    os.path.join(os.path.dirname(__file__), "fill-ticket.py"),
)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)

CDN_BASE = _mod.CDN_BASE
resolve_poster_url = _mod.resolve_poster_url
format_session_datetime = _mod.format_session_datetime


class TestResolvePosterUrl(unittest.TestCase):
    """Poster URL must always be absolute (https://...) in the final email."""

    def test_relative_mx_prefix_gets_cdn(self):
        result = resolve_poster_url("mx/posters/project-hail-mary-261bf935.jpg")
        self.assertEqual(
            result,
            f"{CDN_BASE}mx/posters/project-hail-mary-261bf935.jpg",
        )

    def test_relative_movies_prefix_gets_cdn(self):
        result = resolve_poster_url("movies/posters/andsons.jpg")
        self.assertEqual(result, f"{CDN_BASE}movies/posters/andsons.jpg")

    def test_full_url_passes_through(self):
        full = "https://movingstory-prod.imgix.net/mx/posters/foo.jpg"
        self.assertEqual(resolve_poster_url(full), full)

    def test_http_url_passes_through(self):
        full = "http://example.com/poster.jpg"
        self.assertEqual(resolve_poster_url(full), full)

    def test_result_always_starts_with_https(self):
        for path in [
            "mx/posters/foo.jpg",
            "movies/posters/bar.jpg",
            "https://cdn.example.com/baz.jpg",
        ]:
            result = resolve_poster_url(path)
            self.assertTrue(
                result.startswith("http"),
                f"resolve_poster_url({path!r}) returned {result!r} — not absolute",
            )


class TestFormatSessionDatetime(unittest.TestCase):
    """Session datetime must match 'Fri 10 Apr, 11:00AM' pattern in the email."""

    def test_iso_datetime_formatted(self):
        result = format_session_datetime("2026-04-10T11:00:00")
        self.assertEqual(result, "Fri 10 Apr, 11:00AM")

    def test_iso_datetime_pm(self):
        result = format_session_datetime("2026-04-10T20:00:00")
        self.assertEqual(result, "Fri 10 Apr, 8:00PM")

    def test_iso_datetime_with_minutes(self):
        result = format_session_datetime("2026-04-10T14:20:00")
        self.assertEqual(result, "Fri 10 Apr, 2:20PM")

    def test_preformatted_passes_through(self):
        pre = "Fri 10 Apr, 11:00AM"
        self.assertEqual(format_session_datetime(pre), pre)

    def test_preformatted_pm_passes_through(self):
        pre = "Wed 8 Apr, 6:30PM"
        self.assertEqual(format_session_datetime(pre), pre)

    def test_date_only_defaults_to_midnight(self):
        """Bare date parses as midnight — valid edge case."""
        result = format_session_datetime("2026-04-10")
        self.assertEqual(result, "Fri 10 Apr, 12:00AM")

    def test_garbage_input_rejected(self):
        with self.assertRaises(ValueError):
            format_session_datetime("next tuesday maybe")

    def test_iso_with_timezone_rejected_gracefully(self):
        """ISO with timezone offset — should still format correctly."""
        result = format_session_datetime("2026-04-10T11:00:00+10:00")
        self.assertEqual(result, "Fri 10 Apr, 11:00AM")

    def test_midnight_session(self):
        result = format_session_datetime("2026-04-10T00:00:00")
        self.assertEqual(result, "Fri 10 Apr, 12:00AM")

    def test_noon_session(self):
        result = format_session_datetime("2026-04-10T12:00:00")
        self.assertEqual(result, "Fri 10 Apr, 12:00PM")


if __name__ == "__main__":
    unittest.main()
