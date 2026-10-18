"""Checks the subject-line topic guard against past good and bad topics."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from outreach import topic_problem  # noqa: E402

cases = [
    ("Gut Health Coaching", "Julia Loggins, Gut Health Coach", True),
    ("Gut Health Gurus", "Gut Health Gurus", False),
    ("F1 Verdict Shorts", "F1 Verdict", False),
    ("Hucubama Shorts", "Hucubama FPV", False),
    ("Nella Cucina", "Nella Cutlery Canada", False),
    ("Kitchen Knives", "Nella Cutlery Canada", True),
    ("Freego eBikes", "Freego eBikes Official", False),
    ("Thailand Expat Videos", "Aussie Nomad Life", False),
    ("Southeast Asia Relocation Consults", "Aussie Nomad Life", True),
    ("Maroon Money", "TWU Maroon Money", False),
    ("Student Money Coaching", "TWU Maroon Money", True),
    ("Google Sheets Templates", "Shine Vision", True),
    ("Watch Reviews", "24 Hours Time", False),
    ("Step Aerobics", "Chris Dorner Fitness", True),
    ("DIY Plumbing", "Plumber X", True),
]
fail = 0
for topic, company, ok in cases:
    problem = topic_problem({"topic": topic, "company": company})
    good = (problem == "") == ok
    fail += not good
    print(("ok  " if good else "FAIL"), f"{topic!r:40} {company!r:35} -> {problem or 'accepted'}")
print("ALL PASS" if not fail else f"{fail} FAILED")
