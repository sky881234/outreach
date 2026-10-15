---
name: send-outreach
description: Send the cold outreach email for an approved free-value Short and run the follow-up pipeline. Uploads the final video to YouTube as Unlisted, emails the prospect with the play-button thumbnail linked to it at 9am their time, then the Google Apps Script engine follows up every 2 days (up to 10x) until they reply, choosing the "seen"/"not seen" version by whether the video got views. Use when the user approves a video and says "send it", "send the outreach", "send now", or asks about outreach status, replies, who watched, stopping a prospect, test emails, follow-up templates, or A/B results.
---

# Send outreach

Everything lives in `C:\Projects\outreach\`. The engine is an Apps Script bound to the **Outreach** Google Sheet (account contactmatthew2200@gmail.com). It runs hourly on Google's servers, so follow-ups go out with the PC off. The local side is `outreach.py`, which calls the engine, and `yt_upload.py`, which drives YouTube Studio.

The user's time zone is HKT. Most prospects are in the US. Emails go out at about 9am in the prospect's time zone, roughly 9â€“10pm HKT for the US East Coast.

## Sending flow (user says "send it" for an approved video)

1. **Find the lead folder** under `C:\Projects\opus-vid-2\FREE_VALUE\<Lead>\`. Pick these files:
   - **`video`**: the exact final mp4 the user approved in this chat. Never guess between versions. If unclear, ask.
   - **`thumbnail`**: the play-button thumbnail, usually `output/thumbnail_play.png` or `*Thumbnail_PlayButton*.png`.
2. **Gather the prospect's details** from the README, the `research/` folder and the channel:
   - Email: from the channel About page, the website or the research files. If you can't find it, ask the user. Never invent one.
   - First name: the person's name, not the brand.
   - Company / channel name.
   - Timezone: an IANA name inferred from their location. If unknown, leave it out and the engine defaults to `America/New_York`.
3. **Write `<Lead>\outreach\lead.json`** (create the folder):
   ```json
   {
     "email": "info@nikkidinezza.com",
     "first_name": "Nikki",
     "company": "Dr. DiNezza - Gut Microbiome Queen",
     "channel_url": "https://www.youtube.com/@gutmicrobiomequeen",
     "topic": "Group Coaching",
     "hook": "You want more group coaching clients struggling with gut health.",
     "touches": ["...up to 10 lines, see below..."],
     "tz": "America/New_York",
     "video": "C:\\...\\output\\GMQ_Magnesium_Short_v3.mp4",
     "thumbnail": "C:\\...\\output\\thumbnail_play.png",
     "title": "8, 9, 10 capsules of magnesium just to poop?! Gut doctor explains"
   }
   ```
   - **`topic`**: 1â€“3 words naming what they sell or do. It fills the subject line "Question About {topic}".
   - **`hook`**: one plain sentence in the user's voice, "You want more <the customers or result they want>." Keep it under about 15 words, with no hype or flattery.
   - **`touches`**: the touch point for each follow-up, in order (follow-up 1 uses the first line).
     - Each is one sentence about a different problem they likely have, which this service fixes without extra work from them. Base them on the research about their channel.
     - The user's own example: "This solution does not require you to do any extra work to get results."
     - Never make claims about results, prices or guarantees the user hasn't stated. If you leave this out, the engine uses the Touches tab.
   - **`title`**: the YouTube title. Use the README's suggested title, or a clean human title rather than the file name.
4. **Preview**: run `python C:\Projects\outreach\outreach.py preview <lead.json>`.
   - Copy the returned `template_id` into lead.json as `"initial_template"`. Then the email you show is the one that actually gets sent.
   - Show the user the subject, the body, `send_at_hkt`, and one line on each follow-up version.
   - If `duplicate` is true, say so: this prospect was already emailed.
5. **Wait for the user's go-ahead.** Skip the preview step only if they explicitly said to send without one.
6. **Send**: run `python C:\Projects\outreach\outreach.py send <lead.json>`. Add `--now` only if they said "send now".
   - This uploads the video first (a Chrome window opens on the PC for 1â€“3 minutes) and saves `video_url` back into lead.json, so a retry never uploads twice.
   - Reply with the YouTube link, the send time in HKT and in their time zone, and "follow-ups are automatic until they reply".

## Other commands (run from `C:\Projects\outreach`)

- `python outreach.py status`: counts, the latest 25 leads (status, step, watched, next send in HKT, reply snippet) and A/B stats. Summarize briefly for Telegram.
- `python outreach.py stop EMAIL`: stop follow-ups for one prospect, for example when they replied somewhere else.
- `python outreach.py send <lead.json> --test THEIR_OWN_EMAIL`: send the first email to the user right away to check how it looks. There are no follow-ups and it's excluded from stats.
- **Correcting after-reply state:** when the user says "booked X", "drop X", "close X" or "resume X", run
  `python -c "import outreach,json; print(json.dumps(outreach.call({'action':'set_status','email':'X','status':'booked'})))"`
  with `status` set to `booked` / `dropped` / `closed` / `waiting` (check-in pings) / `active` (the original sequence). The reply wording rules (`HARD_STOP`, `DECLINE`) live in `Code.js`; test changes with `node test\intent_test.js`.
- `python outreach.py run`: process due sends and reply checks now, instead of waiting for the hourly run.

## Statuses (Leads tab)

| Status | Meaning |
|---|---|
| `scheduled` | The first email is waiting for 9am their time. |
| `active` | In the follow-up sequence. |
| `replied` | They replied. Automatic follow-ups stop and the user handles the conversation. A Telegram reminder goes out if it's unanswered after `REPLY_REMINDER_HOURS`. |
| `waiting` | The user answered and is waiting on them. Nothing is sent automatically. |
| `booked` / `dropped` | Set from the check-in buttons, or by Claude with `set_status`. No more pings or emails. |
| `closed` | They asked to unsubscribe or stop. Closed immediately, no more emails. |

**Check-in pings for `waiting` leads:**
- Every `CHECKIN_PING_DAYS` (2) of quiet, Telegram gets a ping with three buttons: ðŸ“¨ Send follow-up, ðŸ“… Call booked, ðŸ—‘ Drop. Quiet is counted from the user's last email to them or the last ping.
- **Send follow-up** sends the Templates kind `nudge` email (N1, which includes `{booking_link}` = Settings `BOOKING_LINK`, the Calendly link). It goes now if it's inside their morning window, otherwise at their next morning.
- The user's own manual emails to the prospect restart the 2-day clock.
- How a tap reaches the engine: the Telegram bridge (`~/.claude/channels/telegram/bridge.mjs`, `handleOutreachCallback`) receives button data `oc|<op>|<lead_id>` and POSTs `lead_action` to the web app, using `C:\Projects\outreach\config.json`.
- Buttons only work while the bridge is running.
| `bounced` | The email bounced. |
| `finished` | All 10 follow-ups were sent. Replies are still watched for 21 days, then it becomes `done`. |
| `stopped` | Stopped manually. |
| `error` | 3 send failures in a row. See `last_error`. |

Out-of-office auto-replies do not stop the sequence.

"Watched" means the unlisted video's YouTube view count went above what it was when the lead was added. Each video is made for one prospect, so a view means they (or someone they forwarded it to) watched.

## Templates and A/B testing (in the Sheet)

- **Templates tab**: columns `template_id | kind (initial/followup) | branch (any/seen/unseen) | subject | body | active`.
  - Placeholders: `{first_name} {company} {topic} {hook} {touch} {video_url} {thumbnail}`. `{thumbnail}` becomes the clickable play-button image.
  - To A/B test, add another active row of the same kind and branch. The engine gives each send to the least-used version, so versions stay balanced.
  - Test one change at a time, subject lines first. About 100 sends per version are needed before reply-rate differences mean much.
  - Follow-ups reuse the thread, so their subject is ignored ("Re: <original>").
- **Touches tab**: fallback touch lines, used when a lead has no `touches` of its own.
- **Stats tab**, rebuilt hourly:
  - First email: watched % and reply % per template.
  - Follow-ups and touch lines: replies per send. A reply is credited to the last email sent before it.
  - Replies by step.
- **Settings tab**: `SEND_HOUR_LOCAL`, `FOLLOWUP_GAP_DAYS` (2), `MAX_FOLLOWUPS` (10), `DAILY_SEND_CAP` (60), `SEND_WINDOW_HOURS` (3, random time 9:00â€“12:00), `MAX_SENDS_PER_RUN` (2), `SKIP_WEEKENDS`, `PAUSED`.
- **Telegram reply alerts** are on. They go to the user's Telegram group via the bridge bot. The token and chat ID are stored in Script Properties, not the sheet, and were set with the `set_telegram` web-app action.

**Dashboard tab** (first tab of the sheet): stat tiles plus native Sheets charts.
- The charts are: funnel, daily activity in HKT, first-email A/B rates, follow-up versions per send, and replies by step.
- They read from the `ChartData` tab. Charts are rebuilt only when the data shape changes; bump the `'v2|'` prefix in `updateDashboard_` to force a rebuild after changing chart options.
- It refreshes within 10 minutes of any new event.
- For a visual check, run `python test\export_dashboard.py logs\dashboard.pdf`.

**Open/click tracking (Streak replacement).** Cloudflare Worker `watch` at https://watch.matthewto.workers.dev. Code is in `C:\Projects\outreach\tracker\worker.js`; deploy with `wrangler deploy` from that folder.
- Every email gets a signed 1x1 pixel (`/o/...gif`), and the thumbnail links to `/c/...`, which redirects to the Short.
- Hits are appended to Events as `open` / `click`. Hits within 2 minutes of a send are ignored as security scanners.
- Leads get `opens`, `clicks`, `opened_at` and `clicked_at`. A click marks the lead `seen`.
- The Stats tab shows open % and click % per template and per touch.
- Turn tracking off by blanking `TRACKING_URL` in Settings.
- Worker secrets `SECRET` and `APPS_SCRIPT_URL` must match `config.json`. Set them with `wrangler secret bulk <json file>`. Never pipe them from PowerShell, because the trailing newline breaks the signature check.
- Test the whole chain with `python test\track_test.py https://watch.matthewto.workers.dev`.
- Opens are inflated by Apple Mail privacy. Opening the email in your own Sent folder also counts as an open.

Debug helpers, called through `outreach.call(...)` in Python:
- `{'action':'events','limit':N}` returns the last N events.
- `{'action':'set_setting','key':K,'value':V}` changes a setting.
- `{'action':'upgrade'}` adds new columns and settings rows, and reinstalls the 10-minute trigger. Run it after a deploy.

To change the engine code: edit `apps_script\Code.js`, then run `powershell -File C:\Projects\outreach\deploy.ps1`. This pushes the change and keeps the same web app URL.

## Troubleshooting

- **`LOGIN_REQUIRED` from the upload**: the user must run `python C:\Projects\outreach\yt_upload.py login` at the PC (or over AnyDesk) and sign in to YouTube in the window that opens.
- **Upload failed with a screenshot path**: Read the screenshot. YouTube Studio may have changed a button. Fix the selector in `yt_upload.py`.
  - Workaround: the user uploads by hand and sends you the link. Put it in lead.json as `video_url` and run `send` again; the upload is skipped.
- **`unauthorized` / HTML instead of JSON**: `config.json` and `apps_script\Secret.js` are out of sync, or the deployment changed. Re-run `deploy.ps1`.
- **Engine-side errors**: check the `last_error` column in the Leads tab and the Events tab.

