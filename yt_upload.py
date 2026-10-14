"""Upload a video to YouTube Studio as Unlisted using a saved Chrome profile.

  python yt_upload.py login                      # one time: sign in to YouTube in the window that opens
  python yt_upload.py upload VIDEO --title TITLE # prints {"url": ...}
"""
import argparse
import json
import re
import sys
import time
from pathlib import Path

from playwright.sync_api import TimeoutError as PWTimeout
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
PROFILE = HERE / ".yt_profile"
LOGS = HERE / "logs"


def launch(p):
    return p.chromium.launch_persistent_context(
        str(PROFILE),
        channel="chrome",
        headless=False,
        viewport={"width": 1400, "height": 900},
        ignore_default_args=["--enable-automation"],
        args=["--disable-blink-features=AutomationControlled"],
    )


def studio_base(page, timeout_ms):
    page.goto("https://studio.youtube.com", wait_until="domcontentloaded")
    page.wait_for_url(re.compile(r"studio\.youtube\.com/channel/"), timeout=timeout_ms)
    return re.match(r"https://studio\.youtube\.com/channel/[^/?#]+", page.url).group(0)


def login():
    with sync_playwright() as p:
        ctx = launch(p)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        print("Sign in to YouTube in the Chrome window (30 min limit)...", flush=True)
        base = studio_base(page, 1_800_000)
        print(json.dumps({"ok": True, "channel": base}))
        ctx.close()


def upload(video, title):
    LOGS.mkdir(exist_ok=True)
    with sync_playwright() as p:
        ctx = launch(p)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        try:
            try:
                base = studio_base(page, 45_000)
            except PWTimeout:
                print(json.dumps({"ok": False, "error": "LOGIN_REQUIRED: run `python yt_upload.py login`"}))
                return 2
            page.goto(base + "/videos/upload?d=ud", wait_until="domcontentloaded")
            page.locator("input[type=file]").first.set_input_files(str(video), timeout=60_000)

            box = page.locator("#title-textarea #textbox").first
            box.wait_for(state="visible", timeout=180_000)
            time.sleep(1)
            box.click()
            page.keyboard.press("Control+A")
            page.keyboard.press("Delete")
            page.keyboard.type(title[:100])

            not_kids = page.locator('tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]')
            if not_kids.count():
                not_kids.first.scroll_into_view_if_needed()
                not_kids.first.click()

            # Studio changed the "Video link" markup (Oct 2026): the old selector never matched. The dialog host
            # carries the id as its video-id attribute (it reports as hidden, so don't wait for visibility).
            dlg = page.locator("ytcp-uploads-dialog").first
            url = ""
            for _ in range(150):
                vid = (dlg.get_attribute("video-id") or "") if dlg.count() else ""
                if re.fullmatch(r"[\w-]{11}", vid):
                    url = f"https://youtube.com/shorts/{vid}"
                    break
                hrefs = page.locator('a[href*="youtube.com/shorts/"], a[href*="youtu.be/"]').evaluate_all(
                    "els => els.map(e => e.href)")
                hit = [h for h in hrefs if re.search(r"(shorts/|youtu\.be/)[\w-]{11}", h)]
                if hit:
                    url = hit[0]
                    break
                time.sleep(2)
            else:
                raise RuntimeError("no video link appeared")

            for _ in range(3):
                page.locator("#next-button").click()
                time.sleep(2)
            page.locator('tp-yt-paper-radio-button[name="UNLISTED"]').click()

            # Saving while the file is still uploading would kill the upload when Chrome closes.
            label = page.locator("ytcp-video-upload-progress .progress-label").first
            deadline = time.time() + 1800
            while time.time() < deadline:
                text = label.inner_text() if label.count() else ""
                if "upload" in text.lower() and "complete" not in text.lower() and "%" in text:
                    time.sleep(5)
                    continue
                break
            page.locator("#done-button").click()
            # The page also has a hidden bulk-actions close icon with id close-button (Oct 2026); match only a
            # visible one. The upload is saved once Done is clicked, so a missing dialog must not lose the URL.
            close = page.locator("ytcp-button#close-button:visible, #close-button:visible").first
            try:
                close.wait_for(state="visible", timeout=120_000)
                close.click()
            except PWTimeout:
                pass
            time.sleep(2)
            print(json.dumps({"ok": True, "url": url}))
            return 0
        except Exception as e:
            shot = LOGS / f"yt_fail_{int(time.time())}.png"
            try:
                page.screenshot(path=str(shot), full_page=True)
            except Exception:
                pass
            print(json.dumps({"ok": False, "error": str(e)[:500], "screenshot": str(shot)}))
            return 1
        finally:
            ctx.close()


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("login")
    up = sub.add_parser("upload")
    up.add_argument("video")
    up.add_argument("--title", required=True)
    a = ap.parse_args()
    if a.cmd == "login":
        login()
        return 0
    return upload(Path(a.video), a.title)


if __name__ == "__main__":
    sys.exit(main())
