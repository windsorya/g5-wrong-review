#!/opt/homebrew/opt/python@3.12/bin/python3.12
"""#5099 同步比較接本站嚴格讀檔（G5Sync.init 的 accepts）：真瀏覽器、假 GAS（照 g5-help/gas/core.js 協定）。
跑法：python3.12 tests/e2e_sync_accepts.py
・sync.js 用 g5-help 本機那份（環境變數 G5_SYNC_JS 可改指其他檔），route 到正式網址；需含 options.accepts（g5-help #5099）。
・驗：①雲端那份有版本號但本站讀不懂（且練得多）⇒ 不換上、這台不動、雲端不動、不顯示已同步
     ②空白裝置遇到同一份讀不懂的雲端 ⇒ 不寫進這台
     ③兩份都讀得懂且一樣 ⇒ 照常、沒有衝突（對照組：accepts 沒有把讀得懂的也擋掉）
     ④頁面公開的讀檔判斷：讀不懂那份 false、空白存檔 true
"""
import json
import os
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
URL = (ROOT / "index.html").as_uri()
KEY = "g5wrong.v1"
BLANK_JS = "JSON.stringify(window.G5WrongCore.blank())"          # 在頁面裡產生一份本站讀得懂的空白存檔（JSON 字串）
ODD = json.dumps({"v": 2, "cards": [], "it": [], "log": [{"op": "x%d" % i} for i in range(40)]})
SYNC_JS = Path(os.environ.get("G5_SYNC_JS", str(Path.home() / "Documents/g5-help/sync.js")))
QR_JS = SYNC_JS.with_name("qrcode.js")
EP = "https://script.google.com/macros/s/AKfycbxwo08VVT5tSRf-DsQEoo1hMlCm1YytGTzj89BPtJ6YWjPieuKyAPbnWXjUKagBdL6l/exec"
CODE = "ABCDEFGHJKMN"
STORE = {}
OPS = []          # 假後端收到的每個請求 (op, key)：負向案例要先證明同步真的讀過雲端
RESULTS = []


def check(name, cond, detail=""):
    RESULTS.append(bool(cond))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  ← {detail}"))


def backend(route):
    req = json.loads(route.request.post_data or "{}")
    k = (req.get("code"), req.get("key"))
    rev, data, upd = STORE.get(k, (0, None, None))
    op = req.get("op")
    OPS.append((op, req.get("key")))
    if op == "ping":
        body = {"ok": True}
    elif op == "get":
        body = {"ok": True, "rev": rev, "data": data, "updated": upd}
    elif op == "put":
        if req.get("rev") != rev:
            body = {"ok": False, "err": "conflict", "rev": rev, "data": data, "updated": upd}
        else:
            now = int(time.time() * 1000)
            STORE[k] = (rev + 1, req.get("data"), now)
            body = {"ok": True, "rev": rev + 1, "updated": now}
    else:
        body = {"ok": False, "err": "bad-op"}
    route.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"}, body=json.dumps(body))


# 包住頁面公開的讀檔判斷，數它被叫幾次（sync.js 的 accepts 會叫它）：負向案例「沒換上」必須是判斷過才沒換，不是同步沒跑
COUNT = r"""
(() => { let f; window.__readable = []; Object.defineProperty(window, 'G5SyncReadable', { configurable: true,
  get() { return f; }, set(v) { f = typeof v === 'function' ? function (r) { const out = v(r); window.__readable.push([r, out]); return out; } : v; } }); })();
"""


def device(browser):
    ctx = browser.new_context()
    ctx.add_init_script(COUNT)
    ctx.route(lambda url: url.startswith(EP), backend)
    ctx.route("https://windsorya.github.io/g5-help/sync.js", lambda r: r.fulfill(body=SYNC_JS.read_text(), content_type="application/javascript"))
    ctx.route("https://windsorya.github.io/g5-help/qrcode.js", lambda r: r.fulfill(body=QR_JS.read_text(), content_type="application/javascript"))
    return ctx


def opened(ctx, errors, local=None, hash_=""):
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(URL); pg.wait_for_load_state("load")
    if local is not None:
        pg.evaluate("([k, v]) => localStorage.setItem(k, v)", [KEY, local])
    if hash_:
        pg.goto(URL + hash_); pg.reload()
    pg.wait_for_load_state("load"); pg.wait_for_timeout(2500)
    return pg


def status(pg):
    return pg.evaluate("(document.querySelector('#g5sync .g5s-status')||{}).textContent||''")


UNSETTLED = ("正在同步", "失敗", "稍後", "離線", "尚未開啟")


def judged(pg, label):
    """負向案例的前提：同步真的 GET 過這個 key、雲端那份 ODD 真的被本站讀檔判斷判成 false、狀態已落定（不是進行中／離線／失敗）。
    等到 ODD 判讀出現為止（最多 10 秒），不靠固定等待。"""
    # 同一個期限內一直等到「ODD 已判讀」且「狀態已落定」兩者同時成立（Codex 審 834ec65：判讀後固定 300ms 會誤判稍晚落定的正常流程）
    try:
        pg.wait_for_function("""([odd, bad]) => {
            const st = ((document.querySelector('#g5sync .g5s-status') || {}).textContent || '').trim();
            return (window.__readable || []).some(c => c[0] === odd) && st !== '' && !bad.some(w => st.includes(w)); }""",
            arg=[ODD, list(UNSETTLED)], timeout=10000)
    except Exception:
        pass
    st = status(pg)
    calls = pg.evaluate("window.__readable || []")
    check(label + " 前提：同步讀過雲端（GET " + KEY + "）", ("get", KEY) in OPS, OPS[-5:])
    check(label + " 前提：雲端那份被讀檔判斷判成讀不懂", any(c[0] == ODD and c[1] is False for c in calls), [(c[0][:30], c[1]) for c in calls])
    check(label + " 前提：狀態已落定（非進行中／離線／失敗）", st.strip() != "" and not any(w in st for w in UNSETTLED), st)


def main():
    if "options.accepts" not in SYNC_JS.read_text():
        print(f"FAIL 前提：{SYNC_JS} 沒有 options.accepts（g5-help #5099 還沒進這份 sync.js）")
        return 1
    with sync_playwright() as p:
        br = p.chromium.launch()
        errors = []
        probe = device(br); pp = opened(probe, errors)
        blank = pp.evaluate(BLANK_JS)
        check("④ 頁面讀檔判斷：空白存檔＝讀得懂", pp.evaluate("(r) => window.G5SyncReadable(r)", blank) is True)
        check("④ 頁面讀檔判斷：有版本號但格式不對＝讀不懂", pp.evaluate("(r) => window.G5SyncReadable(r)", ODD) is False)
        probe.close()

        STORE.clear(); STORE[(CODE, KEY)] = (1, ODD, int(time.time() * 1000))
        OPS.clear(); d = device(br); pg = opened(d, errors, local=blank, hash_="#sync=" + CODE)
        judged(pg, "①")
        check("① 雲端讀不懂（40 筆）沒換上：這台還是自己那份", pg.evaluate("(k) => localStorage.getItem(k)", KEY) == blank)
        check("① 雲端那份不動（rev 1）", STORE[(CODE, KEY)][:2] == (1, ODD), STORE[(CODE, KEY)][0])
        check("① 不顯示已同步", "已同步" not in status(pg), status(pg))
        d.close()

        STORE.clear(); STORE[(CODE, KEY)] = (1, ODD, int(time.time() * 1000))
        OPS.clear(); d = device(br); pg = opened(d, errors, hash_="#sync=" + CODE)
        judged(pg, "②")
        check("② 空白裝置：讀不懂的雲端沒寫進這台", pg.evaluate("(k) => localStorage.getItem(k)", KEY) is None,
              (pg.evaluate("(k) => localStorage.getItem(k)", KEY) or "")[:80])
        check("② 雲端那份不動", STORE[(CODE, KEY)][:2] == (1, ODD))
        d.close()

        STORE.clear(); STORE[(CODE, KEY)] = (1, blank, int(time.time() * 1000))
        d = device(br); pg = opened(d, errors, local=blank, hash_="#sync=" + CODE)
        check("③ 對照：兩份都讀得懂且一樣 ⇒ 已同步、沒有衝突", "已同步" in status(pg) and STORE[(CODE, KEY)][0] == 1, (status(pg), STORE[(CODE, KEY)][0]))
        d.close()
        check("沒有 JS 錯誤", not errors, errors)
        br.close()
    print(f"{sum(RESULTS)}/{len(RESULTS)} PASS")
    return 0 if all(RESULTS) else 1


if __name__ == "__main__":
    sys.exit(main())
