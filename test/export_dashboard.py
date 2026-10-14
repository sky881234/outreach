"""Export the Dashboard tab to PNG (via PDF) using clasp's stored Google credentials, for a visual check."""
import json
import re
import sys
from pathlib import Path

import requests

SHEET_ID = "1_FV278gPVd8WB4pySgK_f9wBJi4kowjtZAADlIG8JCw"
out = Path(sys.argv[1])

t = json.loads((Path.home() / ".clasprc.json").read_text())["tokens"]["default"]
tok = requests.post("https://oauth2.googleapis.com/token", data={
    "client_id": t["client_id"], "client_secret": t["client_secret"],
    "refresh_token": t["refresh_token"], "grant_type": "refresh_token"}, timeout=30).json()["access_token"]
h = {"Authorization": f"Bearer {tok}"}

# Find the Dashboard gid from the sheet's HTML-less feed: the Sheets API isn't in clasp's scopes, so read the export of htmlview.
html = requests.get(f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/htmlview", headers=h, timeout=60).text
m = re.search(r'name:\s*"Dashboard",[^}]*?gid:\s*"(\d+)"', html) or re.search(r'"Dashboard"[^0-9]{0,80}?(\d{4,})', html)
gid = m.group(1) if m else None
print("gid:", gid)
url = (f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=pdf&gid={gid}"
       "&size=A4&portrait=false&fitw=true&gridlines=false&printtitle=false&sheetnames=false&pagenum=UNDEFINED")
r = requests.get(url, headers=h, timeout=120)
print("export:", r.status_code, r.headers.get("content-type"), len(r.content))
out.write_bytes(r.content)
