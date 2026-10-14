# Outreach

Cold outreach for personalized "free value" YouTube Shorts: upload the approved Short as Unlisted, email the prospect at their local morning, follow up every 2 days (up to 10x) until they reply, and track opens, clicks, watches and replies per email version for A/B testing.

## Pieces

| Path | What it is |
|---|---|
| `apps_script/Code.js` | The engine, an Apps Script bound to the **Outreach** Google Sheet. It runs every 10 min on Google's servers and handles sending (Gmail API, threaded follow-ups), reply/bounce detection, YouTube view checks, stats, the Dashboard charts, and Telegram reply alerts. |
| `tracker/worker.js` | Cloudflare Worker for the open pixel and click redirect, logged back to the engine. |
| `outreach.py` | Local CLI: `preview`, `send`, `status`, `stop`, `run`. |
| `yt_upload.py` | Uploads a video to YouTube Studio as Unlisted with Playwright and a saved Chrome profile. |
| `yt_latest.py` | Lists the newest channel uploads, to recover a link if an upload finished but the script didn't. |
| `deploy.ps1` | Pushes `apps_script/` with clasp and updates the web-app deployment. It also writes `config.json` and generates `Secret.js` the first time. |
| `skill/SKILL.md` | The Claude Code skill (`send-outreach`) that drives the flow from Telegram. |
| `test/` | Offline logic checks (`harness.js`), a live tracker check, and a dashboard export. |

## Sheet tabs

| Tab | Contents |
|---|---|
| Dashboard | Stat tiles and charts. |
| Leads | One row per prospect. |
| Templates | Email versions, used for A/B. |
| Touches | Fallback lines for the follow-up touch point. |
| Events | Every send, open, click, reply and bounce. |
| Stats | Rates per template and per touch line. |
| ChartData | Data feeding the Dashboard charts. |
| Settings | Send window, gaps, caps, pause switch, tracking URL. |

## Setup (new machine)

1. `npm i -g @google/clasp wrangler`, then `clasp login` and `wrangler login`. Enable the Apps Script API at https://script.google.com/home/usersettings.
2. Run `powershell -File deploy.ps1`. Then, in the script editor, run `setup` once to grant permissions.
3. Tracker:
   - `cd tracker`
   - Create a JSON file with `SECRET` (the value in `apps_script/Secret.js`) and `APPS_SCRIPT_URL` (the `webapp_url` in `config.json`).
   - Run `wrangler secret bulk <file>`, then `wrangler deploy`.
   - Put the worker URL in Settings → `TRACKING_URL`.
4. `python yt_upload.py login` and sign in to the YouTube channel.

Secrets are git-ignored: `config.json`, `apps_script/Secret.js`, `.yt_profile/`.
