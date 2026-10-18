"""Open/click rates for tracked first emails, grouped by the recipient domain's mail provider (MX lookup)."""
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import outreach  # noqa: E402


def mx_provider(domain):
    out = subprocess.run(["powershell", "-NoProfile", "-Command",
                          f"(Resolve-DnsName {domain} -Type MX -ErrorAction SilentlyContinue).NameExchange -join ' '"],
                         capture_output=True, text=True).stdout.lower()
    if "google" in out:
        return "Google Workspace"
    if "outlook" in out or "protection.outlook" in out:
        return "Microsoft 365"
    if not out.strip():
        return "no MX"
    return "other (" + out.split()[0] + ")"


ev = outreach.call({"action": "events", "limit": 5000})["events"]
ts = lambda e: datetime.fromisoformat(e["ts"].replace("Z", "+00:00"))  # noqa: E731
sent = {(e["lead_id"], str(e["step"])): e for e in ev if e["event"] == "sent"}
opened = defaultdict(bool)
for e in ev:
    if e["event"] in ("open", "click"):
        s = sent.get((e["lead_id"], str(e["step"])))
        if s and ts(e) - ts(s) >= timedelta(minutes=2):
            opened[e["lead_id"]] = True
replied = {e["lead_id"] for e in ev if e["event"] == "replied"}
start = datetime(2026, 10, 11, 14, 0, tzinfo=ts(ev[0]).tzinfo)

leads = {}
for (lid, step), s in sent.items():
    if ts(s) >= start:
        leads[lid] = s["email"].lower()

agg = defaultdict(lambda: [0, 0, 0])
cache = {}
for lid, email in leads.items():
    dom = email.split("@")[1]
    if dom in ("gmail.com", "googlemail.com"):
        prov = "@gmail.com address"
    else:
        prov = cache.get(dom) or cache.setdefault(dom, mx_provider(dom))
    agg[prov][0] += 1
    agg[prov][1] += opened[lid]
    agg[prov][2] += lid in replied
for prov, (n, o, r) in sorted(agg.items(), key=lambda x: -x[1][0]):
    print(f"{prov:34} leads {n:3}  opened {o:3} ({100*o/n:3.0f}%)  replied {r}")
