"""Deliverability signals from the Events log: open/click/reply rates for tracked sends, split by recipient provider."""
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import outreach  # noqa: E402

ev = outreach.call({"action": "events", "limit": 5000})["events"]
ts = lambda e: datetime.fromisoformat(e["ts"].replace("Z", "+00:00"))  # noqa: E731

opens = [e for e in ev if e["event"] == "open"]
tracking_start = min(ts(e) for e in opens if not e["lead_id"].startswith("LTEST")) if opens else None
print("tracking first saw a real open at:", tracking_start)

sent = [e for e in ev if e["event"] == "sent"]
by_send = {}
for e in sent:
    by_send[(e["lead_id"], str(e["step"]))] = e
email_of = {e["lead_id"]: e["email"] for e in sent}

flags = defaultdict(lambda: {"open": False, "click": False})
for e in ev:
    if e["event"] in ("open", "click"):
        s = by_send.get((e["lead_id"], str(e["step"])))
        if s and ts(e) - ts(s) >= timedelta(minutes=2):
            flags[(e["lead_id"], str(e["step"]))][e["event"]] = True

replied = {e["lead_id"] for e in ev if e["event"] == "replied"}
bounced = {e["lead_id"] for e in ev if e["event"] == "bounced"}
seen = {e["lead_id"] for e in ev if e["event"] == "seen"}

# Only sends made after tracking was switched on, and at least a day old (time to be opened).
cutoff = datetime.now(tracking_start.tzinfo) - timedelta(days=1) if tracking_start else None
rows = [(k, s) for k, s in by_send.items() if tracking_start and ts(s) >= tracking_start - timedelta(hours=1) and ts(s) <= cutoff]


def provider(addr):
    d = addr.split("@")[-1].lower()
    if d in ("gmail.com", "googlemail.com"):
        return "gmail.com"
    if d in ("outlook.com", "hotmail.com", "live.com", "msn.com"):
        return "microsoft"
    if d in ("yahoo.com", "icloud.com", "me.com", "aol.com"):
        return "yahoo/apple/aol"
    return "company domain"


agg = defaultdict(lambda: [0, 0, 0])
for k, s in rows:
    g = provider(s["email"])
    agg[g][0] += 1
    agg[g][1] += flags[k]["open"]
    agg[g][2] += flags[k]["click"]
    agg["ALL"][0] += 1
    agg["ALL"][1] += flags[k]["open"]
    agg["ALL"][2] += flags[k]["click"]

print(f"\nTracked sends older than 1 day: {agg['ALL'][0]}")
for g, (n, o, c) in sorted(agg.items(), key=lambda x: -x[1][0]):
    print(f"  {g:16} sends {n:3}  opened {o:3} ({100*o/n:4.0f}%)  clicked {c:2}")

leads = {e["lead_id"] for e in sent}
print(f"\nLeads emailed: {len(leads)}  replied: {len(replied & leads)}  watched video: {len(seen & leads)}  bounced: {len(bounced & leads)}")
first_opened = {k[0] for k, f in flags.items() if f["open"]}
print(f"Leads with at least one tracked open: {len(first_opened)}")
