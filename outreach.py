"""Local front end for the Outreach Apps Script engine.

  python outreach.py preview lead.json            # render the first email + sample follow-ups, no sending
  python outreach.py send lead.json [--now]       # upload video if needed, then schedule (or send now)
  python outreach.py send lead.json --test ME@x   # send the first email to ME@x right away, no follow-ups
  python outreach.py status | run | stop EMAIL

lead.json: email, first_name, company, channel_url, topic, hook, touches[], tz,
           video (local mp4), thumbnail (local png), title, video_url (filled after upload),
           initial_template (from preview)
"""
import argparse
import base64
import io
import json
import subprocess
import sys
from pathlib import Path

import requests
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.stdout.reconfigure(encoding="utf-8")


def call(payload):
    cfg = json.loads((HERE / "config.json").read_text())
    payload = dict(payload, secret=cfg["secret"])
    r = requests.post(cfg["webapp_url"], json=payload, timeout=330)
    r.raise_for_status()
    try:
        return r.json()
    except ValueError:
        return {"ok": False, "error": "non-JSON response", "body": r.text[:500]}


def thumb_b64(path):
    im = Image.open(path).convert("RGB")
    w = 360
    im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=85, optimize=True)
    return base64.b64encode(buf.getvalue()).decode()


def lead_fields(lead):
    keys = ["email", "first_name", "company", "channel_url", "topic", "hook", "touches", "tz", "video_url", "notes"]
    return {k: lead[k] for k in keys if k in lead}


def ensure_uploaded(lead_path, lead):
    if lead.get("video_url"):
        return lead
    title = lead.get("title") or Path(lead["video"]).stem
    out = subprocess.run(
        [sys.executable, str(HERE / "yt_upload.py"), "upload", lead["video"], "--title", title],
        capture_output=True, text=True, encoding="utf-8",
    )
    last = (out.stdout.strip().splitlines() or ["{}"])[-1]
    res = json.loads(last) if last.startswith("{") else {"ok": False, "error": out.stderr[-500:]}
    if not res.get("ok"):
        print(json.dumps({"ok": False, "stage": "youtube_upload", **res}, indent=2))
        sys.exit(1)
    lead["video_url"] = res["url"]
    lead_path.write_text(json.dumps(lead, indent=2, ensure_ascii=False), encoding="utf-8")
    return lead


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    pv = sub.add_parser("preview")
    pv.add_argument("lead")
    sd = sub.add_parser("send")
    sd.add_argument("lead")
    sd.add_argument("--now", action="store_true")
    sd.add_argument("--test", metavar="EMAIL")
    sd.add_argument("--force", action="store_true")
    sub.add_parser("status")
    sub.add_parser("run")
    st = sub.add_parser("stop")
    st.add_argument("email")
    a = ap.parse_args()

    if a.cmd in ("preview", "send"):
        path = Path(a.lead)
        lead = json.loads(path.read_text(encoding="utf-8"))
        if a.cmd == "preview":
            fields = lead_fields(lead)
            fields.setdefault("video_url", "https://youtube.com/shorts/XXXXXXXXXXX")
            res = call({"action": "preview", "lead": dict(fields, initial_template=lead.get("initial_template"))})
        else:
            lead = ensure_uploaded(path, lead)
            fields = lead_fields(lead)
            if a.test:
                fields["email"] = a.test
            res = call({
                "action": "enqueue", "lead": fields, "thumb_b64": thumb_b64(lead["thumbnail"]),
                "initial_template": lead.get("initial_template"), "send_now": a.now,
                "test": bool(a.test), "force": a.force,
            })
            res["video_url"] = lead["video_url"]
    elif a.cmd == "stop":
        res = call({"action": "stop", "email": a.email})
    else:
        res = call({"action": a.cmd})
    print(json.dumps(res, indent=2, ensure_ascii=False, default=str))
    return 0 if res.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
