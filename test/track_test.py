"""Hit the live tracker with a signed token for a fake lead and confirm both events land in the Events tab."""
import base64
import hashlib
import hmac
import json
import sys
import time
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import outreach  # noqa: E402

cfg = json.loads((Path(__file__).resolve().parents[1] / "config.json").read_text())
base = sys.argv[1].rstrip("/")
data = "LTEST%d.0.k4636tI9OSc" % int(time.time())
sig = base64.urlsafe_b64encode(hmac.new(cfg["secret"].encode(), data.encode(), hashlib.sha256).digest()).decode()[:12]
token = f"{data}.{sig}"

o = requests.get(f"{base}/o/{token}.gif", timeout=30)
print("open :", o.status_code, o.headers.get("content-type"), len(o.content), "bytes")
c = requests.get(f"{base}/c/{token}", allow_redirects=False, timeout=30)
print("click:", c.status_code, c.headers.get("location"))
bad = requests.get(f"{base}/c/{data}.AAAAAAAAAAAA", allow_redirects=False, timeout=30)
print("bad sig click:", bad.status_code, bad.headers.get("location"), "(should redirect but not log)")

lead_id = data.split(".")[0]
for _ in range(12):
    time.sleep(5)
    evs = [e for e in outreach.call({"action": "events", "limit": 15})["events"] if e["lead_id"] == lead_id]
    if len(evs) >= 2:
        break
for e in evs:
    print("logged:", e["event"], "step", e["step"], "|", e["detail"][:80])
print("PASS" if sorted(e["event"] for e in evs) == ["click", "open"] else "FAIL")
