#!/usr/bin/env python3
"""
Probe a phone/IP-camera URL and a few common stream endpoint variants.

Examples:
  python video_url_probe.py http://192.168.1.194:4747/video
  python video_url_probe.py http://192.168.1.194:4747
"""

from __future__ import annotations

import argparse
import sys
import urllib.request
from html.parser import HTMLParser
from urllib.parse import urlsplit, urlunsplit
from urllib.parse import urljoin

try:
    import cv2
except ImportError:
    print("pip install opencv-python", file=sys.stderr)
    raise SystemExit(1)


class MediaLinkParser(HTMLParser):
    def __init__(self, base_url: str) -> None:
        super().__init__()
        self.base_url = base_url
        self.links: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr_map = {k.lower(): v for k, v in attrs if v}
        for key in ("src", "href", "data-src"):
            val = attr_map.get(key)
            if val:
                self.links.append(urljoin(self.base_url, val))


def candidates(url: str) -> list[str]:
    parts = urlsplit(url)
    base_path = parts.path.rstrip("/")
    root = urlunsplit((parts.scheme, parts.netloc, "", "", ""))
    out = [url]
    if base_path:
        out.append(root)
    for suffix in (
        "/video",
        "/video/640x480",
        "/video/1280x720",
        "/video/1920x1080",
        "/mjpegfeed",
        "/mjpegfeed?640x480",
        "/videofeed",
        "/shot.jpg",
    ):
        out.append(root + suffix)
    seen = set()
    uniq = []
    for item in out:
        if item not in seen:
            seen.add(item)
            uniq.append(item)
    return uniq


def http_probe(url: str) -> str:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "pavois-probe"})
        with urllib.request.urlopen(req, timeout=3) as resp:
            ctype = resp.headers.get("Content-Type", "unknown")
            return f"HTTP {resp.status} {ctype}"
    except Exception as exc:
        return f"HTTP_FAIL {type(exc).__name__}: {exc}"


def html_links(url: str) -> list[str]:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "pavois-probe"})
        with urllib.request.urlopen(req, timeout=3) as resp:
            ctype = resp.headers.get("Content-Type", "")
            if "html" not in ctype.lower():
                return []
            html = resp.read(200_000).decode("utf-8", errors="replace")
        parser = MediaLinkParser(url)
        parser.feed(html)
        seen = set()
        links = []
        for link in parser.links:
            if link not in seen:
                seen.add(link)
                links.append(link)
        return links
    except Exception:
        return []


def opencv_probe(url: str, backend: str) -> str:
    api = cv2.CAP_FFMPEG if backend == "FFMPEG" else 0
    cap = cv2.VideoCapture(url, api) if api else cv2.VideoCapture(url)
    if not cap.isOpened():
        cap.release()
        return "CV_CLOSED"
    ok, frame = cap.read()
    cap.release()
    if ok and frame is not None and getattr(frame, "size", 0) > 0:
        h, w = frame.shape[:2]
        return f"CV_OK {w}x{h}"
    return "CV_OPEN_NO_FRAME"


def main() -> None:
    p = argparse.ArgumentParser(description="Probe video URLs for OpenCV.")
    p.add_argument("url")
    args = p.parse_args()

    for url in candidates(args.url):
        http = http_probe(url)
        cv_default = opencv_probe(url, "DEFAULT")
        cv_ffmpeg = opencv_probe(url, "FFMPEG")
        print(f"{url}")
        print(f"  {http}")
        print(f"  OpenCV DEFAULT: {cv_default}")
        print(f"  OpenCV FFMPEG:  {cv_ffmpeg}")
        links = html_links(url)
        if links:
            print("  HTML links:")
            for link in links[:12]:
                print(f"    {link}")


if __name__ == "__main__":
    main()
