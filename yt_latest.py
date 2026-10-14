"""Print the newest videos on the channel (id, title, visibility) from YouTube Studio, using the saved profile.
Recovers the URL when an upload succeeded but yt_upload.py failed after Done.  python yt_latest.py [n]"""
import json
import re
import sys
import time

from playwright.sync_api import sync_playwright

import yt_upload


def main(n=5):
    with sync_playwright() as p:
        ctx = yt_upload.launch(p)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        try:
            base = yt_upload.studio_base(page, 45_000)
            page.goto(base + "/videos/short", wait_until="domcontentloaded")
            page.locator("ytcp-video-row").first.wait_for(timeout=60_000)
            time.sleep(2)
            rows = []
            for r in page.locator("ytcp-video-row").all()[:n]:
                hrefs = r.locator("a[href*='/video/']").evaluate_all("els => els.map(e => e.href)")
                vid = next((m.group(1) for h in hrefs for m in [re.search(r"/video/([\w-]{11})", h)] if m), None)
                title = r.locator("#video-title").first.inner_text() if r.locator("#video-title").count() else ""
                vis = r.locator(".visibility-cell, #visibility-text, ytcp-video-visibility-select").first
                rows.append({"id": vid, "title": title.strip(), "url": f"https://youtube.com/shorts/{vid}",
                             "visibility": vis.inner_text().strip() if vis.count() else ""})
            print(json.dumps(rows, ensure_ascii=False, indent=1))
        finally:
            ctx.close()


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 5)
