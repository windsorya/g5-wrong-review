#!/usr/bin/env python3
"""把 src/app.html（Artifact 格式：沒有 doctype/head）包成可直接開啟的 index.html。

與自然／數學／社會站同一套做法：GitHub Pages 要自己帶 viewport 與 noindex；
<!--@INLINE src/x.js--> 換成 <script> 內容，核心邏輯（src/core.js）與 node 測試共用同一份檔。
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
HEAD = ('<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
        '<meta name="robots" content="noindex,nofollow">'
        '<link rel="icon" type="image/svg+xml" href="favicon.svg">'
        '<link rel="apple-touch-icon" href="apple-touch-icon.png">'
        '<meta name="theme-color" content="#1f5f8b">'
        '<meta name="apple-mobile-web-app-capable" content="yes">'
        '<meta name="apple-mobile-web-app-title" content="錯題複習">'
        '</head><body>')

INLINE = re.compile(r"<!--@INLINE (src/[A-Za-z0-9_.-]+\.js)-->")


def inline(body: str) -> str:
    def sub(m: re.Match) -> str:
        js = (ROOT / m.group(1)).read_text(encoding="utf-8")
        if "</script" in js.lower():
            raise SystemExit(f"{m.group(1)} 含 </script，不能內嵌")
        return "<script>\n" + js + "\n</script>"
    out = INLINE.sub(sub, body)
    if "<!--@INLINE" in out:
        raise SystemExit("還有沒換掉的 @INLINE 標記")
    return out


def main() -> None:
    body = inline((ROOT / "src" / "app.html").read_text(encoding="utf-8"))
    (ROOT / "index.html").write_text(HEAD + body + "</body></html>", encoding="utf-8")
    print(f"built index.html ({len(body)} chars)")


if __name__ == "__main__":
    main()
