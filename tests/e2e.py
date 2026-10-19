#!/usr/bin/env python3
"""錯題複習 e2e：Chromium 桌機／手機 390、WebKit iPad。
用 python3.12 執行：python3.12 tests/e2e.py [--root 其他版本的目錄] [--base https://windsorya.github.io/g5-wrong-review/] [--only M]
・網站用 route 掛在假的 https 網域（https://g5wrong.test/）＝安全來源，Chromium、WebKit 都有 navigator.locks；
  同一個 context 開兩頁＝同一瀏覽器的兩個分頁（共用 localStorage 與鎖），不用兩個 context 冒充。
・外部服務一律攔下：字型擋掉、qrcode.js 給空檔、sync.js 換成同步替身（照真 sync.js 的順序：先 canReplace 再 accept；
  沒有 accept 的頁面替身就直接寫 key＋onReplaced，等於舊版 sync.js 的行為）、上傳 GAS 由各測試自己 route。
・題庫還是空的時候也要驗得到練習流程 ⇒ 用 window.G5WrongTestItems 在頁面載入前放測試題（正式網頁不會有這個變數）。
・矩陣列（M01…M34，設計書 docs/storage-design-b-codex-designer-20261013.md 第 4 節）每一項標 [D]（存檔／記憶體內容）或 [UI]（畫面文字）。"""
import base64
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ARGS = sys.argv[1:]
def arg(name):
    return ARGS[ARGS.index(name) + 1] if name in ARGS else None

ROOT = Path(arg("--root") or Path(__file__).resolve().parent.parent).resolve()
ORIGIN = "https://g5wrong.test/"
BASE = (arg("--base").rstrip("/") + "/") if arg("--base") else ORIGIN
URL = BASE + "index.html"
ONLY = arg("--only")
KEY = "g5wrong.v1"
GAS = "https://script.google.com/macros/s/**"
RESULTS = []
ORDER = ["五上自然複習", "五上數學複習", "五上國語複習", "五上社會複習", "錯題複習", "難題解說"]
HREF = {"五上自然複習": "https://windsorya.github.io/g5-sci-review/", "五上數學複習": "https://windsorya.github.io/g5-math-review/",
        "五上國語複習": "https://windsorya.github.io/g5-chinese-review/", "五上社會複習": "https://windsorya.github.io/g5-social-review/",
        "難題解說": "https://windsorya.github.io/g5-help/"}
ITEMS = [
    {"id": "w-ma-1008-1", "subject": "數學", "source": "10/8 數學小考", "added": "2026-10-08", "type": "choice",
     "q": "3/4 和 6/8 哪一個比較大？", "opts": ["3/4", "6/8", "一樣大"], "a": 2, "her": "3/4", "why": "6/8 上下同除以 2 就是 3/4。兩個一樣大。"},
    {"id": "w-ch-1009-1", "subject": "國語", "source": "10/9 國語小考", "added": "2026-10-09", "type": "fill",
     "q": "「再接再厲」的「厲」是什麼意思？", "a": ["磨", "磨刀"], "why": "厲是磨刀石，引申為磨。"},
    {"id": "w-sc-1010-1", "subject": "自然", "source": "10/10 自然小考", "added": "2026-10-10", "type": "tf",
     "q": "太陽從西邊升起。", "a": False, "why": "太陽從東邊升起、西邊落下。"},
]
A_, B_, C_ = ITEMS
BAD = {"id": "w-bad", "subject": "體育", "source": "x", "added": "2026-10-10", "type": "tf", "q": "壞題", "a": True, "why": "壞"}
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
RO_MSG = "另一個分頁正在練習，請回那一頁"

SYNC_STUB = r"""
window.G5Sync = { init: function (o) {
  window.__syncInits = (window.__syncInits || 0) + 1; window.__syncOpts = o;
  return { destroy: function () { window.__syncDestroyed = (window.__syncDestroyed || 0) + 1; window.__syncOpts = null; } };
} };
window.__check = function () { var o = window.__syncOpts; if (!o) return 'no-init'; return typeof o.canReplace === 'function' ? !!o.canReplace('g5wrong.v1') : true; };
window.__commit = function (raw) {
  var o = window.__syncOpts; if (!o) return 'no-init';
  if (typeof o.accept === 'function') return o.accept('g5wrong.v1', raw) ? 'accepted' : 'rejected';
  localStorage.setItem('g5wrong.v1', raw); if (o.onReplaced) o.onReplaced('g5wrong.v1'); return 'written';
};
window.__propose = function (raw) { var c = window.__check(); if (c === 'no-init') return c; if (!c) return 'deferred'; return window.__commit(raw); };
"""

INIT = r"""
(() => {
  const S = Storage.prototype, rs = S.setItem, rg = S.getItem;
  window.__sets = 0;
  window.__rawGet = (k) => rg.call(localStorage, k);
  window.__rawSet = (k, v) => rs.call(localStorage, k, v);
  S.setItem = function (k, v) {
    if (window.__failSet && k === 'g5wrong.v1') throw new DOMException('full', 'QuotaExceededError');
    if (k === 'g5wrong.v1') window.__sets++;
    return rs.call(this, k, v);
  };
  S.getItem = function (k) {
    if (window.__failGet && k === 'g5wrong.v1') throw new DOMException('denied', 'SecurityError');
    return rg.call(this, k);
  };
  const rn = Date.now; Date.now = function () { return typeof window.__T === 'number' ? window.__T : rn(); };
  window.__marker = String(Math.random());
  window.__chimes = 0;
})();
"""


def check(name, cond, detail=""):
    RESULTS.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  ← {str(detail)[:300]}"))


def serve(route):
    url = route.request.url
    rel = url[len(ORIGIN):].split("?")[0].split("#")[0] or "index.html"
    f = (ROOT / rel).resolve()
    if ROOT not in f.parents or not f.is_file():
        return route.fulfill(status=404, body="not found")
    ct = "text/html; charset=utf-8" if f.suffix == ".html" else "application/javascript" if f.suffix == ".js" else "text/plain"
    route.fulfill(status=200, content_type=ct, body=f.read_bytes())


SYNC_URL = "https://windsorya.github.io/g5-help/sync.js"
EXPORTS = "https://windsorya.github.io/*/weak-export.js"


def new_ctx(browser, device=None, items=None, seed=None, code=None, flags="", sync=None):
    """seed：放進 g5wrong.v1 的原始字串（整個 context 只放一次，重新整理與第二頁都讀到頁面自己存的）。flags：額外的 init JS。
    sync：None＝同步替身（SYNC_STUB）；檔案路徑＝把那份真的 sync.js 掛在正式網址上；"live"＝不攔、載正式網址那份。"""
    ctx = browser.new_context(**(device or {}))
    ctx.route("https://g5wrong.test/**", serve)
    ctx.route("https://fonts.googleapis.com/**", lambda r: r.abort())
    ctx.route("https://fonts.gstatic.com/**", lambda r: r.abort())
    ctx.route("https://windsorya.github.io/g5-help/qrcode.js", lambda r: r.fulfill(status=200, content_type="application/javascript", body=""))
    if sync is None:
        ctx.route(SYNC_URL, lambda r: r.fulfill(status=200, content_type="application/javascript", body=SYNC_STUB))
    elif sync != "live":
        js = Path(sync).read_bytes()
        ctx.route(SYNC_URL, lambda r: r.fulfill(status=200, content_type="application/javascript", body=js))
    ctx.route(GAS, lambda r: r.abort())
    # 各科待加強（#3016）：四個科目站的 weak-export.js 預設一律 404（既有測試不連網、不受科目站上線與否影響）；
    # tests/e2e_appweak.py 在 context 上另掛替身（後掛的 route 優先）
    ctx.route(EXPORTS, lambda r: r.fulfill(status=404, body="not found"))
    init = INIT + flags
    if items is not None:
        init += f"window.G5WrongTestItems = {json.dumps(items, ensure_ascii=False)};"
    once = ""
    if seed is not None:
        once += f"window.__rawSet('g5wrong.v1', {json.dumps(seed)});"
    if code:
        once += f"window.__rawSet('g5sync.code', {json.dumps(code)});"
    if once:
        init += "if (window.__rawGet('__seeded') === null) { window.__rawSet('__seeded', '1');" + once + "}"
    ctx.add_init_script(init)
    return ctx


def mode(pg):
    return pg.evaluate("window.G5WrongApp && G5WrongApp.mode ? G5WrongApp.mode() : 'legacy'")


def wait_main(pg):
    pg.wait_for_selector("#main .btn, #main .empty", timeout=8000)


def wait_ready(pg):
    try:
        pg.wait_for_function("!(window.G5WrongApp && G5WrongApp.mode) || G5WrongApp.mode() === 'READY'", timeout=4000)
    except Exception:
        pass


def page_in(ctx, ready=True):
    pg = ctx.new_page()
    pg.set_default_timeout(6000)
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(URL)
    wait_main(pg)
    if ready:
        wait_ready(pg)
    pg.__errors = errors
    return pg


def open_page(browser, device=None, items=None, state=None, code=None, label=""):
    ctx = new_ctx(browser, device, items=items, seed=None if state is None else json.dumps(state), code=code)
    pg = page_in(ctx)
    return ctx, pg, pg.__errors


def reload(pg):
    pg.reload()
    wait_main(pg)
    wait_ready(pg)


def RAW(pg):
    return pg.evaluate("window.__rawGet('g5wrong.v1')")


def D(pg):
    r = RAW(pg)
    return None if r is None else json.loads(r)


def DIT(pg):
    d = D(pg)
    return {} if not d else d.get("it", {})


def MST(pg):
    return pg.evaluate("G5WrongApp.state()")


def no_overflow(page):
    return page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")


def nav(page):
    return page.evaluate("[...document.querySelectorAll('#siteNav a, #siteNav [aria-current]')].map(e=>[e.textContent.trim(), e.getAttribute('href'), e.getAttribute('aria-current')])")


def today(page):
    return page.evaluate("G5WrongCore.dayKey(Date.now())")


def cur_item(page):
    q = page.locator("#qText").inner_text()
    return next(i for i in ITEMS if i["q"] == q)


def opt_key(it, right):
    if it["type"] == "choice":
        return it["a"] if right else (it["a"] + 1) % len(it["opts"])
    return 0 if (it["a"] if right else not it["a"]) else 1


def answer(page, right):
    it = cur_item(page)
    if it["type"] in ("choice", "tf"):
        page.locator(f'#main .opt[data-k="{opt_key(it, right)}"]').click()
    else:
        page.fill("#fillIn", it["a"][-1] if right else "不知道")
        page.locator("#fillIn").press("Enter")
    page.wait_for_selector("#fb")
    return it


def banners(pg):
    return pg.locator("#banners").inner_text()


def try_answer(pg, it, right=True, home=True):
    """孩子的操作：按那一科的考前總複習、看得到題目就作答。回傳是否真的出了題。"""
    b = pg.locator(f'#main .sub[data-sub="{it["subject"]}"]')
    if not b.count():
        return False
    b.click()
    pg.wait_for_timeout(120)
    if not pg.locator("#qText").count():
        return False
    answer(pg, right)
    if home:
        go_home(pg)
    return True


def go_home(pg):
    for sel in ("#quit", "#homeBtn"):
        if pg.locator(sel).count():
            pg.locator(sel).click()
            return


def take(pg):
    """等待頁按「改在這一頁練習」，等它拿到寫入資格（舊版沒有這個按鈕＝本來就能寫）。"""
    if pg.locator("#takeBtn").count():
        pg.locator("#takeBtn").click()
        try:
            pg.wait_for_function("G5WrongApp.mode() === 'READY'", timeout=4000)
        except Exception:
            pass


def open_details(pg, sel):
    if not pg.locator(sel).evaluate("e => e.open"):
        pg.locator(sel + " > summary").click()


def do_reset(pg):
    open_details(pg, "#setBox")
    pg.locator("#resetBtn").click()
    pg.locator("#resetYes").click()
    return pg.locator("#resetMsg").inner_text()


def hide(pg, id_):
    open_details(pg, "#listBox")
    b = pg.locator(f'[data-hide="{id_}"]')
    if b.count():
        b.click()


def unhide(pg, id_):
    open_details(pg, "#listBox")
    if pg.locator("#hiddenBox").count():
        open_details(pg, "#hiddenBox")
    b = pg.locator(f'[data-unhide="{id_}"]')
    if b.count():
        b.click()


def capture_old(pg, it):
    """把目前題目「答對」按鈕的 handler 存起來，之後重播（模擬舊畫面的 handler 被觸發）。"""
    if it["type"] == "fill":
        pg.evaluate("() => { window.__old = document.querySelector('#fillGo').onclick; document.querySelector('#fillIn').value = " + json.dumps(it["a"][0]) + "; }")
    else:
        pg.evaluate(f"() => {{ window.__old = document.querySelector('#main .opt[data-k=\"{opt_key(it, True)}\"]').onclick; }}")


def replay_old(pg):
    pg.evaluate("() => { try { window.__old && window.__old(); } catch (e) { window.__oldErr = String(e); } }")
    pg.wait_for_timeout(80)


def v1(it=None, hidden=None, settings=None, **extra):
    o = {"v": 1, "it": it or {}, "settings": settings or {"sound": False, "tone": 0}}
    if hidden is not None:
        o["hidden"] = hidden
    o.update(extra)
    return json.dumps(o)


def ent(**o):
    e = {"n": 1, "ok": 1, "bad": 0, "s": 1, "m": False, "last": "2026-10-01", "due": "2026-10-02", "log": [["2026-10-01", 1]]}
    e.update(o)
    return e


def v2(it=None, hidden=None, settings=None):
    return json.dumps({"v": 2, "it": it or {}, "hidden": hidden or {}, "settings": settings or {"sound": True, "tone": 0}})


def hidden_on(d, id_):
    h = (d or {}).get("hidden", {}).get(id_)
    return h is True or (isinstance(h, (int, float)) and not isinstance(h, bool) and h > 0)


# ======================= 原有流程 =======================
def flow_empty(browser, label, device=None):
    ctx, pg, errors = open_page(browser, device)
    check(f"{label} 標題與倒數", "錯題複習" in pg.title() and pg.locator("#days").inner_text().strip().isdigit())
    got = nav(pg)
    check(f"{label} 切換列六項、順序：各科→錯題複習→難題解說", [g[0] for g in got] == ORDER, got)
    check(f"{label} 切換列：本站 aria-current、其他五站連到對的網址",
          all((g[2] == "page" and g[1] is None) if g[0] == "錯題複習" else (g[1] == HREF[g[0]] and g[2] is None) for g in got), got)
    check(f"{label} 題庫空的：說明怎麼上傳，沒有開始按鈕", pg.locator("#main .empty").count() == 1 and pg.locator("#goToday").count() == 0)
    check(f"{label} 沒有水平捲動", no_overflow(pg))
    pg.locator("#upBox summary").click()
    pg.locator("#upSend").click()
    check(f"{label} 沒開同步就送：提示先開同步", "跨裝置同步" in pg.locator("#upMsg").inner_text(), pg.locator("#upMsg").inner_text())
    check(f"{label} 沒有 JS 錯誤", not errors, errors)
    ctx.close()


def flow_practice(browser, label, device=None):
    ctx, pg, errors = open_page(browser, device, items=ITEMS + [BAD])
    check(f"{label} 壞題不出、頁面寫出哪一題有問題", "w-bad" in pg.locator("#banners").inner_text() and pg.evaluate("G5WrongApp.items().length") == 3)
    check(f"{label} 今天要練 3 題", pg.locator("#dueN").inner_text() == "3")
    check(f"{label} 考前總複習有全部＋三科", pg.locator("#main .sub").count() == 4)
    check(f"{label} 首頁沒有水平捲動", no_overflow(pg))
    pg.locator("#goToday").click()
    first = answer(pg, right=False)
    fb = pg.locator("#fb").inner_text()
    check(f"{label} 答錯：顯示正確答案與解說", "正確答案" in fb and first["why"].split("。")[0] in fb, fb)
    if first.get("her"):
        check(f"{label} 答錯：顯示小考時寫的答案", "小考時寫的是：" + first["her"] in fb, fb)
    check(f"{label} 答錯後選項鎖住", pg.locator("#main .opt:not([disabled]), #fillIn:not([disabled])").count() == 0)
    check(f"{label} 題目卡沒有水平捲動", no_overflow(pg))
    pg.locator("#nextBtn").click()
    a2 = answer(pg, right=True)
    check(f"{label} 答對：顯示答對了", "答對了" in pg.locator("#fb").inner_text())
    pg.locator("#nextBtn").click()
    answer(pg, right=True)
    pg.locator("#nextBtn").click()
    total = pg.locator("#main .qhead span").first.inner_text()
    check(f"{label} 答錯的那題在最後再出一次（共 4 題）", "/ 4" in total and cur_item(pg)["id"] == first["id"], total)
    answer(pg, right=True)
    check(f"{label} 同一天再做對：註明只算練習", "只算練習" in pg.locator("#fb").inner_text())
    pg.locator("#nextBtn").click()
    done = pg.locator("#main .done").inner_text()
    check(f"{label} 結尾：答對 3、答錯 1", "答對 3 次" in done and "答錯 1 次" in done, done)
    s = pg.evaluate("G5WrongApp.state()")
    t = today(pg)
    e1, e2 = s["it"][first["id"]], s["it"][a2["id"]]
    check(f"{label} 紀錄：答錯那題 連對 0、明天再出；先錯後對不算對", e1["s"] == 0 and e1["bad"] == 1 and e1["ok"] == 1 and e1["due"] > t, e1)
    check(f"{label} 紀錄：答對那題 連對 1、明天再出", e2["s"] == 1 and e2["due"] > t, e2)
    pg.locator("#homeBtn").click()
    check(f"{label} 回首頁：今天練完了", pg.locator("#dueN").inner_text() == "0" and pg.locator("#goToday").is_disabled())
    reload(pg)
    check(f"{label} 重新整理後進度還在", pg.locator("#dueN").inner_text() == "0" and pg.evaluate("Object.keys(G5WrongApp.state().it).length") == 3)
    pg.locator("#listBox > summary").click()
    lst = pg.locator("#list").inner_text()
    check(f"{label} 錯題清單分科列出、有狀態", all(x in lst for x in ["數學", "國語", "自然", "再練"]), lst)
    pg.locator('#main .sub[data-sub="數學"]').click()
    check(f"{label} 數學考前總複習：只出數學 1 題（不管排程）", "/ 1 題" in pg.locator("#main .qhead span").first.inner_text() and cur_item(pg)["subject"] == "數學")
    check(f"{label} 沒有 JS 錯誤", not errors, errors)
    ctx.close()


def flow_master(browser):
    # 連對兩天、今天到期：今天答對＝學會
    ctx, pg, errors = open_page(browser, items=ITEMS[:1], state={"v": 1, "it": {}, "settings": {"sound": False, "tone": 0}})
    t = today(pg)
    y = pg.evaluate(f"G5WrongCore.addDays('{t}', -3)")
    st = {"v": 1, "it": {ITEMS[0]["id"]: {"n": 2, "ok": 2, "bad": 0, "s": 2, "m": False, "last": y, "due": t, "log": []}}, "settings": {"sound": False, "tone": 0}}
    pg.evaluate(f"window.__rawSet('g5wrong.v1', {json.dumps(json.dumps(st))})")
    reload(pg)
    pg.locator("#goToday").click(); answer(pg, True); pg.locator("#nextBtn").click()
    check("學會：連三個不同天答對，結尾寫新學會 1 題", "新學會 1 題" in pg.locator("#main .done").inner_text())
    pg.locator("#homeBtn").click()
    check("學會：首頁「已經學會」變 1", pg.locator("#main .three div").nth(1).locator("b").inner_text() == "1")
    check("學會流程沒有 JS 錯誤", not errors, errors)
    ctx.close()


def flow_hide_reset(browser, label, device=None):
    # 律師 2026-10-13：「為何我測試用的題目，我沒法清除？有無清除或重置按鈕？」
    ctx, pg, errors = open_page(browser, device, items=ITEMS)
    pg.locator("#listBox > summary").click()
    pg.locator(f'[data-hide="{ITEMS[0]["id"]}"]').click()
    check(f"{label} 不用再練：今天要練 3→2、考前總複習少一科", pg.locator("#dueN").inner_text() == "2" and pg.locator("#main .sub").count() == 3)
    check(f"{label} 不用再練：清單底下列出已隱藏 1 題", "已設成不用再練的 1 題" in pg.locator("#list").inner_text())
    reload(pg)
    check(f"{label} 不用再練：重新整理後仍隱藏", pg.locator("#dueN").inner_text() == "2")
    pg.locator("#goToday").click()
    seen = set()
    for _ in range(2):
        seen.add(answer(pg, True)["id"]); pg.locator("#nextBtn").click()
    check(f"{label} 隱藏的題不會出現在今天的複習", ITEMS[0]["id"] not in seen and pg.locator("#main .done").count() == 1, seen)
    pg.locator("#homeBtn").click()
    open_details(pg, "#listBox")
    pg.locator("#hiddenBox summary").click()
    pg.locator(f'[data-unhide="{ITEMS[0]["id"]}"]').click()
    check(f"{label} 恢復：那題回到今天要練（1 題）", pg.locator("#dueN").inner_text() == "1" and pg.locator("#hiddenBox").count() == 0)
    pg.locator("#setBox summary").click()
    pg.locator("#resetBtn").click()
    check(f"{label} 清除要按第二次確認（不用對話框）", pg.locator("#resetYes").is_visible() and pg.evaluate("Object.keys(G5WrongApp.state().it).length") == 2)
    pg.locator("#resetNo").click()
    check(f"{label} 按「不要清除」紀錄還在", pg.evaluate("Object.keys(G5WrongApp.state().it).length") == 2 and pg.locator("#resetBtn").is_visible())
    pg.locator(f'[data-hide="{ITEMS[1]["id"]}"]').click()
    pg.locator("#resetBtn").click(); pg.locator("#resetYes").click()
    s = pg.evaluate("G5WrongApp.state()")
    check(f"{label} 確定清除：作答紀錄歸零、隱藏名單保留、今天要練回到 2", s["it"] == {} and [k for k in s["hidden"] if hidden_on(s, k)] == [ITEMS[1]["id"]] and pg.locator("#dueN").inner_text() == "2", s)
    reload(pg)
    check(f"{label} 清除後重新整理仍是清除狀態", pg.evaluate("Object.keys(G5WrongApp.state().it).length") == 0)
    check(f"{label} 清除／隱藏流程沒有 JS 錯誤", not errors, errors)
    ctx.close()


def flow_codex_151f6f09(browser):
    """Codex 審 151f6f09 抓到的四個反例（①改成單一寫入分頁語意：另一頁唯讀、接手後才可寫）。"""
    ctx = new_ctx(browser, items=ITEMS)
    a = page_in(ctx); b = page_in(ctx, ready=False)
    errs = a.__errors + b.__errors
    a.locator('#main .sub[data-sub="自然"]').click()
    ids = [answer(a, True)["id"]]
    b.locator('#main .sub[data-sub=""]').click()
    check("兩分頁：後開的那頁按開始被拒、寫出「另一個分頁正在練習」", b.locator("#qText").count() == 0 and RO_MSG in banners(b), banners(b))
    a.locator("#nextBtn").click(); a.locator("#homeBtn").click()
    take(b)
    b.locator('#main .sub[data-sub="數學"]').click(); ids.append(answer(b, True)["id"])
    saved = sorted(DIT(a))
    check("兩分頁：接手後各答的題紀錄都在（不互相覆蓋）", saved == sorted(ids), saved)
    b.locator("#quit").click()
    take(a)
    msg = do_reset(a)
    check("兩分頁：接手的那頁清除成功", "已清除" in msg and DIT(a) == {}, msg)
    b.locator('#main .sub[data-sub=""]').click()
    check("A 清除時 B 是唯讀：B 舊畫面按開始被拒、不寫入", b.locator("#qText").count() == 0 and DIT(a) == {})
    take(b)
    b.locator('#main .sub[data-sub="國語"]').click(); last = answer(b, True)["id"]
    check("A 清除後 B 接手再作答：只多 B 這一題，舊紀錄沒有復活", list(DIT(a)) == [last], DIT(a))
    check("兩分頁流程沒有 JS 錯誤", not errs, errs)
    ctx.close()
    # ②練習中把下一題設成不用再練：不再出現
    ctx, pg, errors = open_page(browser, items=ITEMS)
    pg.locator("#goToday").click()
    order = pg.evaluate("G5WrongCore.dueList(G5WrongTestItems.map(x=>x), G5WrongCore.blank(), G5WrongCore.dayKey(Date.now())).map(x=>x.id)")
    pg.locator("#listBox > summary").click()
    pg.locator(f'[data-hide="{order[1]}"]').click()
    answer(pg, True); pg.locator("#nextBtn").click()
    shown = cur_item(pg)["id"] if pg.locator("#qText").count() else None
    s = pg.evaluate("G5WrongApp.state()")
    check("練習中隱藏的題：直接跳過、不記錄", shown != order[1] and order[1] not in s["it"], (order, shown))
    check("隱藏流程沒有 JS 錯誤", not errors, errors)
    ctx.close()
    # ③清除時存不進去：不可宣告成功、紀錄不變
    ctx, pg, errors = open_page(browser, items=ITEMS)
    pg.locator("#goToday").click(); answer(pg, True); pg.locator("#quit").click()
    pg.evaluate("() => { Storage.prototype.setItem = function(){ throw new DOMException('full', 'QuotaExceededError'); }; }")
    msg = do_reset(pg)
    check("清除存不進去：照實說沒成功、畫面紀錄維持原樣", "沒有清除成功" in msg and pg.evaluate("Object.keys(G5WrongApp.state().it).length") == 1, msg)
    ctx.close()
    # ④學會的題當天又做錯：不可說「不影響進度」
    ctx, pg, errors = open_page(browser, items=ITEMS[:1])
    t = today(pg)
    st = {"v": 1, "it": {ITEMS[0]["id"]: {"n": 3, "ok": 3, "bad": 0, "s": 3, "m": True, "last": t, "due": t, "log": []}}, "hidden": {}, "settings": {"sound": False, "tone": 0}}
    pg.evaluate(f"window.__rawSet('g5wrong.v1', {json.dumps(json.dumps(st))})")
    reload(pg)
    pg.locator("#goToday").click(); answer(pg, False)
    fb = pg.locator("#fb").inner_text()
    check("學會的題當天又做錯：不顯示「只算練習」、取消學會", "只算練習" not in fb and pg.evaluate(f"G5WrongApp.state().it['{ITEMS[0]['id']}'].m") is False, fb)
    ctx.close()


def flow_codex_cf61e0ff(browser):
    """Codex 審 cf61e0ff 的反例（真瀏覽器；②改成單一寫入分頁語意）。"""
    # ①存不進去時答 a、b，恢復後答 c ⇒ a、b、c 都在
    ctx, pg, errors = open_page(browser, items=ITEMS)
    pg.evaluate("() => { window.__realSet = Storage.prototype.setItem; Storage.prototype.setItem = function(){ throw new DOMException('full', 'QuotaExceededError'); }; }")
    pg.locator('#main .sub[data-sub=""]').click()
    ids = [answer(pg, True)["id"]]; pg.locator("#nextBtn").click()
    ids.append(answer(pg, True)["id"]); pg.locator("#nextBtn").click()
    pg.evaluate("() => { Storage.prototype.setItem = window.__realSet; }")
    ids.append(answer(pg, True)["id"])
    saved = sorted(DIT(pg))
    check("存不進去期間答的 2 題：恢復後再答 1 題，3 題都存進去", saved == sorted(ids), (saved, ids))
    check("存檔失敗流程沒有 JS 錯誤", not errors, errors)
    ctx.close()
    # ②另一分頁要把這頁正在出的題設成不用再練 ⇒ 那頁唯讀被拒；這頁照常作答、記錄
    ctx = new_ctx(browser, items=ITEMS)
    a = page_in(ctx); b = page_in(ctx, ready=False)
    a.locator('#main .sub[data-sub=""]').click()
    cur = cur_item(a)["id"]
    hide(b, cur)
    a.wait_for_timeout(300)
    check("別頁要隱藏目前這題：那頁唯讀被拒、寫出原因，存檔沒有隱藏", not hidden_on(D(a), cur) and RO_MSG in banners(b), (D(a), banners(b)))
    answer(a, True)
    check("別頁隱藏被拒後：這頁照常作答並存檔", cur in DIT(a))
    ctx.close()


def flow_upload(browser):
    sent, mine = [], {"ok": True, "lastFetch": 0, "items": [
        {"id": "u1", "time": 1760000000000, "subject": "數學", "note": "【錯題】10/8 分數", "status": "fetched", "url": ""},
        {"id": "u2", "time": 1760000000000, "subject": "自然", "note": "難題那邊的", "status": "new", "url": ""}]}

    def handle(route):
        body = json.loads(route.request.post_data or "{}")
        sent.append(body)
        if body.get("op") == "upload":
            route.fulfill(status=200, content_type="application/json", body=json.dumps({"ok": True, "id": "u3"}))
        else:
            route.fulfill(status=200, content_type="application/json", body=json.dumps(mine))
    ctx, pg, errors = open_page(browser, items=[], code="ABCDEFGHJKMN")
    pg.route(GAS, handle)
    pg.locator("#upBox summary").click()
    pg.wait_for_selector("#upList .hcard")
    lst = pg.locator("#upList").inner_text()
    check("上傳進度：只列錯題（難題站的不列）", "10/8 分數" in lst and "難題那邊的" not in lst and "正在打字" in lst, lst)
    pg.locator("#upSend").click()
    check("沒選照片：提示先選", "選一張照片" in pg.locator("#upMsg").inner_text())
    pg.select_option("#upSubj", "國語")
    pg.set_input_files("#upFile", files=[{"name": "q.png", "mimeType": "image/png", "buffer": PNG}])
    pg.fill("#upNote", "10/9 國語小考第 3 題")
    pg.locator("#upSend").click()
    pg.wait_for_function("document.querySelector('#upMsg').textContent.indexOf('送出了')>=0", timeout=15000)
    up = [b for b in sent if b.get("op") == "upload"]
    ok = len(up) == 1 and up[0]["note"] == "【錯題】10/9 國語小考第 3 題" and up[0]["subject"] == "國語" and up[0]["code"] == "ABCDEFGHJKMN" and up[0]["image"].startswith("data:image/jpeg;base64,")
    check("上傳：送到同一條 GAS、補充前面加【錯題】、帶家庭碼與縮過的照片", ok, [dict(b, image=str(b.get("image", ""))[:30]) for b in up])
    check("上傳後清空表單", pg.locator("#upNote").input_value() == "" and pg.evaluate("document.querySelector('#upFile').files.length") == 0)
    check("上傳流程沒有 JS 錯誤", not errors, errors)
    ctx.close()


# ======================= 驗收矩陣（設計書第 4 節）=======================
def two(browser, seed=None, flags=""):
    ctx = new_ctx(browser, items=ITEMS, seed=seed, flags=flags)
    a = page_in(ctx)
    b = page_in(ctx, ready=False)
    return ctx, a, b


def one(browser, seed=None, flags="", items=ITEMS, ready=True):
    ctx = new_ctx(browser, items=items, seed=seed, flags=flags)
    return ctx, page_in(ctx, ready=ready)


def m01_02(br, L):
    ctx, a, b = two(br)
    try_answer(a, A_); try_answer(a, B_)
    got_c = try_answer(b, C_)
    it = DIT(a)
    check(f"{L} M01[D] A 答 a、b；B 嘗試答 c ⇒ D 只有 a、b 各一次", sorted(it) == sorted([A_["id"], B_["id"]]) and all(e["n"] == 1 for e in it.values()), it)
    act = b.locator("#actMsg").inner_text() if b.locator("#actMsg").count() else ""
    check(f"{L} M01[UI] B 出不了題、按下去的回饋是「另一個分頁正在練習，請回那一頁」", not got_c and RO_MSG in banners(b) and RO_MSG in act, (banners(b), act))
    take(b)
    try_answer(b, C_)
    it = DIT(a)
    check(f"{L} M02[D] A 回首頁讓出、B 接手答 c ⇒ D＝a、b、c 各一次", sorted(it) == sorted(x["id"] for x in ITEMS) and all(e["n"] == 1 for e in it.values()), it)
    check(f"{L} M02[UI] 讓出的 A 變唯讀並寫出原因", RO_MSG in banners(a) or mode(a) == "legacy", banners(a))
    ctx.close()


def m03(br, L):
    ctx, a, b = two(br, seed=v1({A_["id"]: ent(), B_["id"]: ent()}))
    do_reset(a)
    try_answer(b, C_)
    check(f"{L} M03[D] A 清除後 B 舊操作答 c 被拒 ⇒ D.it 空", DIT(a) == {}, DIT(a))
    go_home(a); take(b); try_answer(b, C_)
    check(f"{L} M03[D] B 接手再答 c ⇒ 只有 c，a、b 不復活", list(DIT(a)) == [C_["id"]], DIT(a))
    ctx.close()


def m04(br, L):
    ctx, pg = one(br)
    pg.locator('#main .sub[data-sub=""]').click()
    hide(pg, B_["id"])
    shown = [answer(pg, True)["id"]]
    pg.locator("#nextBtn").click()
    if pg.locator("#qText").count():
        shown.append(cur_item(pg)["id"])
    d = D(pg)
    check(f"{L} M04[D] 佇列中的 b 隱藏 ⇒ 不出題、hidden.b、it.b 不增加", B_["id"] not in shown and hidden_on(d, B_["id"]) and B_["id"] not in d["it"], (shown, d))
    ctx.close()


def m05(br, L):
    ctx, pg = one(br, seed=v1({A_["id"]: ent()}))
    pg.evaluate("window.__failSet = true")
    msg = do_reset(pg)
    check(f"{L} M05[D] 清除寫入失敗 ⇒ D、M 都保留 a", A_["id"] in DIT(pg) and A_["id"] in MST(pg)["it"])
    check(f"{L} M05[UI] 顯示沒有清除成功、不同時說已清除", "沒有清除成功" in msg and "已清除" not in msg, msg)
    ctx.close()


def m06(br, L):
    ctx, pg = one(br, items=ITEMS[:1])
    t = today(pg)
    pg.evaluate(f"window.__rawSet('g5wrong.v1', {json.dumps(v1({A_['id']: ent(n=3, ok=3, s=3, m=True, last=t, due=t)}))})")
    reload(pg)
    pg.locator('#main .sub[data-sub="數學"]').click(); answer(pg, False)
    fb = pg.locator("#fb").inner_text()
    e = DIT(pg).get(A_["id"], {})
    tomorrow = pg.evaluate(f"G5WrongCore.addDays('{t}', 1)")
    check(f"{L} M06[D] 學會題同日答錯 ⇒ n=4、bad+1、s=0、m=false、明天到期", e.get("n") == 4 and e.get("bad") == 1 and e.get("s") == 0 and e.get("m") is False and e.get("due") == tomorrow, e)
    check(f"{L} M06[UI] 不顯示「不影響進度」", "不影響進度" not in fb, fb)
    ctx.close()


def m07(br, L):
    ctx, pg = one(br)
    pg.evaluate("window.__failSet = true")
    try_answer(pg, A_); try_answer(pg, B_)
    check(f"{L} M07[D] 寫入失敗期間 M 有 a、b，D 沒增加", sorted(MST(pg)["it"]) == sorted([A_["id"], B_["id"]]) and RAW(pg) is None, (MST(pg)["it"].keys(), RAW(pg)))
    check(f"{L} M07[UI] 顯示「還沒存好，請先不要關閉這頁」", "還沒存好，請先不要關閉這頁" in banners(pg), banners(pg))
    pg.evaluate("window.__failSet = false")
    try_answer(pg, C_)
    it = DIT(pg)
    check(f"{L} M07[D] 恢復後答 c ⇒ D＝a、b、c 各一次", sorted(it) == sorted(x["id"] for x in ITEMS) and all(e["n"] == 1 for e in it.values()), it)
    check(f"{L} M07[UI] 存好後警告消失", "還沒存好" not in banners(pg), banners(pg))
    ctx.close()


def m08(br, L):
    ctx, pg = one(br)
    try_answer(pg, A_)
    pg.evaluate("window.__failSet = true")
    try_answer(pg, B_)
    msg = do_reset(pg)
    check(f"{L} M08[D] 清除也失敗 ⇒ M={{a,b}}、D={{a}}", sorted(MST(pg)["it"]) == sorted([A_["id"], B_["id"]]) and list(DIT(pg)) == [A_["id"]], (MST(pg)["it"].keys(), DIT(pg).keys()))
    check(f"{L} M08[UI] 清除失敗照實說、未存警告仍在", "沒有清除成功" in msg and "還沒存好" in banners(pg), (msg, banners(pg)))
    pg.evaluate("window.__failSet = false")
    if pg.locator("#saveRetry").count():
        pg.locator("#saveRetry").click()
    else:
        pg.wait_for_timeout(3600)
    check(f"{L} M08[D] 恢復儲存並重試 ⇒ D={{a,b}}", sorted(DIT(pg)) == sorted([A_["id"], B_["id"]]), DIT(pg))
    pg.wait_for_timeout(3600)
    check(f"{L} M08[D] 之後不會自動清空", sorted(DIT(pg)) == sorted([A_["id"], B_["id"]]) and sorted(MST(pg)["it"]) == sorted([A_["id"], B_["id"]]), DIT(pg))
    ctx.close()


def m09(br, L):
    ctx, a, b = two(br)
    a.locator('#main .sub[data-sub="數學"]').click()
    capture_old(a, A_)
    hide(b, A_["id"])
    check(f"{L} M09[D] A 正在 a 時 B 隱藏 a 被拒", not hidden_on(D(a), A_["id"]), D(a))
    check(f"{L} M09[UI] B 寫出唯讀原因", RO_MSG in banners(b), banners(b))
    go_home(a); take(b); hide(b, A_["id"])
    check(f"{L} M09[D] B 接手後隱藏 a 成功", hidden_on(D(a), A_["id"]), D(a))
    replay_old(a)
    check(f"{L} M09[D] 重播 A 舊答題事件被拒，it.a 不增加", A_["id"] not in DIT(a), DIT(a))
    ctx.close()


def m12_13(br, L, back):
    ctx, pg = one(br, flags="window.__T = 1791000000000;")
    try_answer(pg, A_)
    if back:
        pg.evaluate("window.__T -= 60000")
    msg = do_reset(pg)
    row = "M13" if back else "M12"
    check(f"{L} {row}[D] {'回撥一分鐘後' if back else '同一毫秒'}清除 ⇒ D、M 都空", DIT(pg) == {} and MST(pg)["it"] == {}, (DIT(pg), MST(pg)["it"].keys()))
    check(f"{L} {row}[UI] 顯示已清除", "已清除" in msg, msg)
    reload(pg)
    check(f"{L} {row}[D] 重新載入仍為空", DIT(pg) == {} and MST(pg)["it"] == {}, DIT(pg))
    ctx.close()


def m14(br, L):
    ctx, a, b = two(br, seed=v1(settings={"sound": True, "tone": 0}))
    open_details(a, "#setBox"); a.select_option("#snd", "off")
    try_answer(b, C_)
    check(f"{L} M14[D] A 關音、B 嘗試作答 ⇒ 存檔仍 sound=false", (D(a) or {}).get("settings", {}).get("sound") is False, D(a))
    take(b)
    b.evaluate("() => { window.G5Tones.play = function(){ window.__chimes++; }; }")
    try_answer(b, C_)
    check(f"{L} M14[D] B 接手作答後存檔 sound=false", (D(a) or {}).get("settings", {}).get("sound") is False, D(a))
    check(f"{L} M14[UI] B 的選單顯示關閉、答對不響", b.locator("#snd").input_value() == "off" and b.evaluate("window.__chimes") == 0, (b.locator("#snd").input_value(), b.evaluate("window.__chimes")))
    ctx.close()


def m15(br, L):
    ctx, pg = one(br, flags="window.__T = 1791000000000;")
    hide(pg, A_["id"])
    pg.evaluate("window.__T -= 60000")
    unhide(pg, A_["id"])
    check(f"{L} M15[D] 回撥後恢復 ⇒ 存檔 a 不隱藏", not hidden_on(D(pg), A_["id"]), D(pg))
    reload(pg)
    check(f"{L} M15[D] 重新載入仍可見（今天要練 3）", pg.locator("#dueN").inner_text() == "3" and not hidden_on(MST(pg), A_["id"]))
    ctx.close()


def m16(br, L):
    ctx, a, b = two(br, seed=v1({A_["id"]: ent(n=3, ok=3, s=3, m=True, last="2026-10-01", due="2026-10-08")}))
    a.locator('#main .sub[data-sub="數學"]').click()
    capture_old(a, A_)
    go_home(a); take(b)
    do_reset(b)
    try_answer(b, A_)
    e1 = DIT(b).get(A_["id"], {})
    check(f"{L} M16[D] B 清除後重新答 q ⇒ n=1、m=false", e1.get("n") == 1 and e1.get("m") is False, e1)
    replay_old(a)
    e2 = DIT(b).get(A_["id"], {})
    check(f"{L} M16[D] 觸發 A 舊 handler 被拒 ⇒ 仍 n=1、m=false（不能變 n=4,m=true）", e2.get("n") == 1 and e2.get("m") is False, e2)
    ctx.close()


def m17(br, L):
    ctx, pg = one(br, seed=v1({A_["id"]: ent()}, hidden={B_["id"]: True}, settings={"sound": False, "tone": 4}))
    pg.locator('#main .sub[data-sub=""]').click()
    do_reset(pg)
    d = D(pg)
    check(f"{L} M17[D] 清除只清 it；b 隱藏與設定 {{sound:false,tone:4}} 保留", d["it"] == {} and hidden_on(d, B_["id"]) and d["settings"] == {"sound": False, "tone": 4}, d)
    check(f"{L} M17[UI] 複習 session 結束（回到首頁）", pg.locator("#qText").count() == 0 and pg.locator("#main .sub").count() > 0)
    ctx.close()


def m18(br, L):
    ctx, pg = one(br, seed=v1({A_["id"]: ent()}))
    raw0, sets0 = RAW(pg), pg.evaluate("window.__sets")
    m0 = MST(pg)
    open_details(pg, "#setBox"); pg.locator("#resetBtn").click(); pg.locator("#resetNo").click()
    check(f"{L} M18[D] 取消清除 ⇒ D、M 不變、沒有寫入", RAW(pg) == raw0 and pg.evaluate("window.__sets") == sets0 and MST(pg) == m0, (raw0, RAW(pg)))
    ctx.close()


def m19(br, L):
    e = ent(n=5, ok=3, bad=2, s=2, last="2026-10-12", due="2099-01-01", log=[["2026-10-11", 0], ["2026-10-12", 1]])
    ctx, pg = one(br, seed=v1({A_["id"]: e}))
    hide(pg, A_["id"]); unhide(pg, A_["id"])
    got = {k: DIT(pg).get(A_["id"], {}).get(k) for k in e}
    check(f"{L} M19[D] 隱藏後恢復 ⇒ a 的 n/ok/bad/s/m/last/due/log 完全不變", got == e, got)
    ctx.close()


def m20(br, L):
    ctx, pg = one(br)
    pg.evaluate("window.__failSet = true")
    pg.locator('#main .sub[data-sub=""]').click()
    capture_old(pg, A_)
    hide(pg, A_["id"])
    cur = cur_item(pg)["id"] if pg.locator("#qText").count() else None
    check(f"{L} M20[D] 寫入失敗時隱藏目前題 a ⇒ M 隱藏並跳過", hidden_on(MST(pg), A_["id"]) and cur != A_["id"], (cur, MST(pg).get("hidden")))
    check(f"{L} M20[UI] 持續顯示未存警告", "還沒存好" in banners(pg), banners(pg))
    replay_old(pg)
    check(f"{L} M20[D] 舊答案不計分（a 與現在這題都沒有紀錄、現在這題仍可作答）", MST(pg)["it"] == {} and pg.locator("#fb").count() == 0, MST(pg)["it"].keys())
    pg.evaluate("window.__failSet = false")
    pg.wait_for_timeout(3600)
    check(f"{L} M20[D] 恢復寫入、重試後 D 隱藏 a", hidden_on(D(pg), A_["id"]) and A_["id"] not in DIT(pg), D(pg))
    ctx.close()


def m21(br, L):
    ctx, pg = one(br, seed=v1(settings={"sound": True, "tone": 4}))
    pg.evaluate("window.__failSet = true")
    open_details(pg, "#setBox"); pg.select_option("#snd", "off")
    try_answer(pg, A_)
    check(f"{L} M21[D] 寫入失敗時關音再答題 ⇒ M.sound=false、tone 仍 4", MST(pg)["settings"] == {"sound": False, "tone": 4}, MST(pg)["settings"])
    pg.evaluate("window.__failSet = false")
    pg.wait_for_timeout(3600)
    check(f"{L} M21[D] 恢復後重試 ⇒ D 設定 {{sound:false,tone:4}}", (D(pg) or {}).get("settings") == {"sound": False, "tone": 4}, D(pg))
    check(f"{L} M21[UI] 選單與存檔一致（關閉）", pg.locator("#snd").input_value() == "off")
    ctx.close()


def m22(br, L):
    raw = v1({A_["id"]: ent()})
    ctx = new_ctx(br, items=ITEMS, seed=raw, flags="window.__failGet = true;")
    pg = page_in(ctx, ready=False)
    try_answer(pg, A_)
    if pg.locator("#resetBtn").count():
        try:
            do_reset(pg)
        except Exception:
            pass
    check(f"{L} M22[D] 讀取失敗 ⇒ 嘗試答題、清除都沒有寫入、原資料不變", pg.evaluate("window.__sets") == 0 and RAW(pg) == raw, (pg.evaluate("window.__sets"), RAW(pg)))
    check(f"{L} M22[UI] 顯示「讀不到原本紀錄，請再讀一次」", "讀不到原本紀錄，請再讀一次" in pg.locator("body").inner_text())
    pg.evaluate("window.__failGet = false")
    if pg.locator("#rereadBtn").count():
        pg.locator("#rereadBtn").click()
    check(f"{L} M22[D] 再讀一次成功後才開放：記憶體是原資料", A_["id"] in MST(pg)["it"] and mode(pg) in ("READY", "legacy"), (mode(pg), MST(pg)["it"].keys()))
    ctx.close()


def m23(br, L):
    # 後兩個：Codex 審 1ed44f8 F4——單題紀錄不是一般物件（v1、v2 各一），舊版會略過它、改設定時把原文覆寫掉
    bad_rec = [json.dumps({"v": v, "it": {A_["id"]: []}, "hidden": {}, "settings": {"sound": False, "tone": 4}}) for v in (2, 1)]
    for raw in ["{壞掉", "[1,2]", '{"v":2,"it":[]}', '{"v":1,"it":"x"}', '{"v":9,"it":{}}'] + bad_rec:
        ctx = new_ctx(br, items=ITEMS, seed=raw)
        pg = page_in(ctx, ready=False)
        try_answer(pg, A_)
        try:
            open_details(pg, "#setBox"); pg.select_option("#snd", "2")
        except Exception:
            pass
        try:
            do_reset(pg)
        except Exception:
            pass
        check(f"{L} M23[D] 壞格式 {raw} ⇒ 原文不變、沒有寫入", RAW(pg) == raw and pg.evaluate("window.__sets") == 0, RAW(pg))
        check(f"{L} M23[UI] 壞格式 {raw} ⇒ 顯示存檔讀不懂", "讀不懂" in pg.locator("body").inner_text())
        ctx.close()


def m24(br, L):
    ctx, pg = one(br)
    check(f"{L} M24[D] 沒有存檔 ⇒ 答題前不寫空白 key", RAW(pg) is None and pg.evaluate("window.__sets") == 0)
    try_answer(pg, A_)
    check(f"{L} M24[D] 首次答案後 D.it.a.n=1", DIT(pg).get(A_["id"], {}).get("n") == 1, DIT(pg))
    ctx.close()


def m25(br, L):
    a = ent(n=2, bad=1)
    for old, hid, sets in [
        ({"v": 1, "it": {A_["id"]: a}}, {}, {"sound": True, "tone": 0}),
        ({"v": 1, "it": {A_["id"]: dict(a, t=7)}, "hidden": {B_["id"]: True, C_["id"]: -5}, "settings": {"sound": False, "tone": 3}}, {B_["id"]: True}, {"sound": False, "tone": 3}),
        ({"v": 1, "it": {}, "hidden": {C_["id"]: 1760000000000}}, {C_["id"]: True}, {"sound": True, "tone": 0}),
    ]:
        ctx, pg = one(br, seed=json.dumps(old))
        d = D(pg)
        want_it = {A_["id"]: a} if old["it"] else {}
        ok = d.get("v") == 2 and d.get("it") == want_it and d.get("hidden") == hid and d.get("settings") == sets
        check(f"{L} M25[D] 舊格式 {sorted(old.keys())} ⇒ 寫成 v2、作答欄位與設定保留、隱藏轉布林", ok, d)
        n0 = pg.evaluate("window.__sets")
        reload(pg)
        check(f"{L} M25[D] 再次載入不重複遷移", pg.evaluate("window.__sets") == 0 and D(pg) == d, pg.evaluate("window.__sets"))
        ctx.close()


def m26(br, L):
    seed = v1({A_["id"]: ent(t=999), B_["id"]: ent(t=1000), C_["id"]: ent(t=1001)}, resetAt=1000)
    ctx, pg = one(br, seed=seed)
    check(f"{L} M26[D] resetAt=1000 ⇒ 遷移後只留 t=1000、1001", sorted(DIT(pg)) == sorted([B_["id"], C_["id"]]) and (D(pg) or {}).get("v") == 2, DIT(pg))
    do_reset(pg)
    check(f"{L} M26[D] 遷移後再次清除全部歸零", DIT(pg) == {}, DIT(pg))
    ctx.close()


def m27(br, L):
    raw = v1({A_["id"]: ent()}, hidden={B_["id"]: True})
    ctx = new_ctx(br, items=ITEMS, seed=raw, flags="window.__failSet = true;")
    pg = page_in(ctx, ready=False)
    got = try_answer(pg, C_)
    check(f"{L} M27[D] 遷移寫入失敗 ⇒ 原始 v1 逐字不變", RAW(pg) == raw, RAW(pg))
    check(f"{L} M27[D] 遷移寫入失敗 ⇒ 不能答題（記憶體沒有 c）", not got and C_["id"] not in MST(pg)["it"], got)
    pg.evaluate("window.__failSet = false")
    if pg.locator("#rereadBtn").count():
        pg.locator("#rereadBtn").click()
    d = D(pg)
    check(f"{L} M27[D] 恢復後再讀 ⇒ 寫成 v2、資料完整", d.get("v") == 2 and list(d["it"]) == [A_["id"]] and d["hidden"] == {B_["id"]: True}, d)
    reload(pg)
    check(f"{L} M27[D] 只轉換一次", pg.evaluate("window.__sets") == 0)
    ctx.close()


BARRIER = """
(() => { const L = navigator.locks; if (!L) return; const req = L.request.bind(L);
  const gate = new Promise((r) => { window.__go = r; });
  L.request = function () { const a = arguments; return gate.then(() => req.apply(null, a)); }; })();
"""


def m28(br, L):
    ctx = new_ctx(br, items=ITEMS, flags=BARRIER)
    pa, pb = ctx.new_page(), ctx.new_page()
    pa.goto(URL); pb.goto(URL)
    pa.evaluate("window.__go && window.__go()"); pb.evaluate("window.__go && window.__go()")
    wait_main(pa); wait_main(pb); pa.wait_for_timeout(400)
    modes = sorted([mode(pa), mode(pb)])
    ga, gb = try_answer(pa, A_), try_answer(pb, B_)
    it = DIT(pa)
    check(f"{L} M28[D] 同時搶鎖 ⇒ 兩頁都嘗試作答，存檔恰有一頁的答案", len(it) == 1 and [ga, gb].count(True) == 1, (modes, list(it)))
    check(f"{L} M28[UI] 恰一頁可寫、另一頁唯讀", modes == ["READY", "RO"], modes)
    ctx.close()


def m29(br, L):
    ctx, a, b = two(br)
    b.evaluate("() => { BroadcastChannel.prototype.postMessage = function(){}; }")
    take(b)
    b.wait_for_timeout(1500)
    got = try_answer(b, C_)
    check(f"{L} M29[D] 通知遺失 ⇒ B 仍唯讀，答不了 c", not got and C_["id"] not in DIT(a), DIT(a))
    check(f"{L} M29[UI] B 仍顯示唯讀", mode(b) == "RO", mode(b))
    try_answer(a, A_)
    check(f"{L} M29[D] A 仍可保存", A_["id"] in DIT(a), DIT(a))
    ctx.close()


def m30(br, L):
    ctx = new_ctx(br, items=ITEMS, seed=v1({A_["id"]: ent()}),
                  flags="try { Object.defineProperty(Navigator.prototype, 'locks', {get(){ return undefined; }, configurable: true}); } catch (e) {}")
    pg = page_in(ctx, ready=False)
    raw = RAW(pg)
    got = try_answer(pg, B_)
    hide(pg, A_["id"])
    check(f"{L} M30[D] 沒有 Web Locks ⇒ 沒有寫入、出不了題", not got and RAW(pg) == raw and pg.evaluate("window.__sets") == 0, (got, RAW(pg)))
    check(f"{L} M30[UI] 顯示無法安全儲存", "無法安全儲存" in pg.locator("body").inner_text())
    ctx.close()


def m31(br, L):
    ctx, pg = one(br)
    pg.evaluate("window.__failSet = true")
    pg.locator('#main .sub[data-sub="數學"]').click()
    capture_old(pg, A_)
    answer(pg, True)
    replay_old(pg); replay_old(pg)
    check(f"{L} M31[D] 寫失敗後重播同題 handler ⇒ n 只加一次", MST(pg)["it"].get(A_["id"], {}).get("n") == 1, MST(pg)["it"])
    pg.evaluate("window.__failSet = false")
    pg.wait_for_timeout(3600)
    check(f"{L} M31[D] 只等重試計時器就存好 ⇒ D.it.a.n=1", DIT(pg).get(A_["id"], {}).get("n") == 1, DIT(pg))
    check(f"{L} M31[UI] 警告消失", "還沒存好" not in banners(pg), banners(pg))
    ctx.close()


def mc6(br, L):
    """契約 6：回首頁再開同一題（同題目 id、新世代）：舊畫面的 handler 不得作用。"""
    ctx, pg = one(br)
    pg.locator('#main .sub[data-sub="數學"]').click()
    capture_old(pg, A_)
    go_home(pg)
    pg.locator('#main .sub[data-sub="數學"]').click()
    replay_old(pg)
    check(f"{L} C6[D] 回首頁再開同一題，重播舊 handler ⇒ 不記錄、這題仍可作答", MST(pg)["it"] == {} and pg.locator("#fb").count() == 0, MST(pg)["it"])
    answer(pg, True)
    check(f"{L} C6[D] 正常作答只記一次", DIT(pg).get(A_["id"], {}).get("n") == 1, DIT(pg))
    ctx.close()


def mf2(br, L):
    """F2（Codex 審 1ed44f8）：舊畫面的「確定清除」handler 不得清掉之後才存好的新答案（契約 6）。"""
    ctx, pg = one(br)
    pg.evaluate("() => { window.__oldReset = document.querySelector('#resetYes').onclick; }")
    try_answer(pg, A_)
    pre = DIT(pg)
    pg.evaluate("() => { try { window.__oldReset && window.__oldReset(); } catch (e) { window.__oldErr = String(e); } }")
    pg.wait_for_timeout(100)
    msg = pg.locator("#resetMsg").text_content() or ""
    check(f"{L} F2[D] 保存舊「確定清除」handler、答 a 存妥後呼叫它 ⇒ 被拒，D 與記憶體仍有 a", A_["id"] in pre and A_["id"] in DIT(pg) and A_["id"] in MST(pg)["it"], (pre, DIT(pg)))
    check(f"{L} F2[UI] 不得顯示清除成功", "已清除" not in msg, msg)
    ctx.close()


def mf3(br, L):
    """F3（Codex 審 1ed44f8）：寫入失敗的自動重試會重繪；正在輸入的填充答案（值、焦點、游標）不能被清掉。"""
    ctx, pg = one(br)
    pg.evaluate("window.__failSet = true")
    pg.locator('#main .sub[data-sub=""]').click()          # 全部科目：a（選擇）→ b（填充）→ c（是非）
    answer(pg, True)                                         # a：答案接受、寫入失敗、排重試計時器
    pg.locator("#nextBtn").click()
    check(f"{L} F3[前提] 下一題是填充題 b", cur_item(pg)["id"] == B_["id"], cur_item(pg)["id"])
    pg.locator("#fillIn").click()
    pg.keyboard.type("磨刀")                                  # 答案輸入到一半，還沒送出
    pg.evaluate("() => { const el = document.querySelector('#fillIn'); el.__mark = 1; el.setSelectionRange(1, 1); }")
    probe = "() => { const el = document.querySelector('#fillIn'); return el ? {v: el.value, same: el.__mark === 1, focus: document.activeElement === el, pos: el.selectionStart} : null; }"
    pg.wait_for_timeout(3600)                                # 重試計時器觸發一次：仍失敗 → 重繪
    st1 = pg.evaluate(probe)
    check(f"{L} F3[UI] 重試（仍失敗）重繪後：輸入值、焦點、游標都不變", st1 == {"v": "磨刀", "same": True, "focus": True, "pos": 1}, st1)
    pg.evaluate("window.__failSet = false")
    pg.wait_for_timeout(3600)                                # 重試成功 → 重繪、警告消失
    st2 = pg.evaluate(probe)
    check(f"{L} F3[UI] 重試成功、警告消失後：輸入值仍在", st2 is not None and st2["v"] == "磨刀" and st2["same"] and "還沒存好" not in banners(pg), (st2, banners(pg)))
    pg.locator("#fillIn").press("Enter")
    pg.wait_for_timeout(150)
    it = DIT(pg)
    check(f"{L} F3[D] 送出後 D 有 a、b 各一次（b 用的是輸入中的答案）", it.get(A_["id"], {}).get("n") == 1 and it.get(B_["id"], {}).get("n") == 1 and it.get(B_["id"], {}).get("ok") == 1, it)
    ctx.close()


def mf3b(br, L):
    """F3 延伸：同一題還沒送出時，畫面因別的操作換世代重建（例如爸媽在清單藏了另一題），輸入中的答案要搬到新的輸入框。"""
    ctx, pg = one(br)
    pg.locator('#main .sub[data-sub=""]').click()
    answer(pg, True); pg.locator("#nextBtn").click()          # a 答完，來到填充題 b
    pg.locator("#fillIn").click(); pg.keyboard.type("磨刀")
    hide(pg, C_["id"])                                         # 藏 c：世代改變、#main 重建，b 仍是目前這一題
    v = pg.evaluate("() => { const el = document.querySelector('#fillIn'); return el ? el.value : null; }")
    check(f"{L} F3b[UI] 同一題重建後，輸入中的答案搬到新的輸入框", v == "磨刀" and cur_item(pg)["id"] == B_["id"], v)
    pg.locator("#fillIn").press("Enter"); pg.wait_for_timeout(150)
    check(f"{L} F3b[D] 送出後 b 記一次答對、c 已隱藏", DIT(pg).get(B_["id"], {}).get("ok") == 1 and hidden_on(D(pg), C_["id"]), D(pg))
    ctx.close()


CLOUD = v2({A_["id"]: ent(n=5, ok=5)}, {C_["id"]: True}, {"sound": False, "tone": 2})


def m32(br, L):
    ctx, a, b = two(br, seed=v1({B_["id"]: ent()}))
    raw0 = RAW(a)
    r = b.evaluate(f"window.__propose({json.dumps(CLOUD)})")
    check(f"{L} M32[D] follower 不初始化同步、提出替換 ⇒ D 不變", b.evaluate("window.__syncInits || 0") == 0 and RAW(a) == raw0, (r, b.evaluate("window.__syncInits || 0")))
    a.locator('#main .sub[data-sub="數學"]').click()
    raw0, mk = RAW(a), a.evaluate("window.__marker")
    r = a.evaluate(f"window.__propose({json.dumps(CLOUD)})"); a.wait_for_timeout(300)
    check(f"{L} M32[D] 練習中提出替換 ⇒ 拒絕、D/M 不變、不 reload", RAW(a) == raw0 and a.evaluate("window.__marker") == mk and a.locator("#qText").count() == 1, r)
    go_home(a)
    a.evaluate("window.__failSet = true"); try_answer(a, A_)
    raw0, m0 = RAW(a), MST(a)
    r = a.evaluate(f"window.__propose({json.dumps(CLOUD)})"); a.wait_for_timeout(300)
    check(f"{L} M32[D] DIRTY 時提出替換 ⇒ 拒絕、D/M 不變", RAW(a) == raw0 and a.evaluate("window.__marker") == mk and MST(a) == m0, r)
    a.evaluate("window.__failSet = false")
    if a.locator("#saveRetry").count():
        a.locator("#saveRetry").click()
    else:
        a.wait_for_timeout(3600)
    raw0, m0 = RAW(a), MST(a)
    r = a.evaluate(f"window.__propose({json.dumps(CLOUD)})"); a.wait_for_timeout(300)
    check(f"{L} M32[D] 本頁已有自己的作答時提出替換 ⇒ 拒絕、D/M 不變", RAW(a) == raw0 and MST(a) == m0, r)
    ctx.close()


def m33(br, L):
    ctx, pg = one(br)
    ok0 = pg.evaluate("window.__check()")
    try_answer(pg, B_)
    r = pg.evaluate(f"window.__commit({json.dumps(CLOUD)})"); pg.wait_for_timeout(300)
    check(f"{L} M33[D] canReplace 先通過、孩子答題後才 accept ⇒ 拒絕、答案保留", B_["id"] in DIT(pg) and A_["id"] not in DIT(pg), (ok0, r, DIT(pg)))
    ctx.close()


def m34(br, L):
    ctx, pg = one(br)
    r = pg.evaluate(f"window.__propose({json.dumps(CLOUD)})"); pg.wait_for_timeout(300)
    try:
        wait_main(pg)
    except Exception:
        pass
    check(f"{L} M34[D] 新裝置接受合法資料 ⇒ 主頁寫入、記憶體換上", RAW(pg) == CLOUD and MST(pg)["it"].get(A_["id"], {}).get("n") == 5, (r, RAW(pg)))
    check(f"{L} M34[UI] 畫面跟著換（首頁顯示已隱藏 1 題後的 2 題）", pg.locator("#main .sub").count() == 3)
    ctx.close()
    ctx, pg = one(br, flags="window.__failSet = true;")
    try:
        r = pg.evaluate(f"window.__propose({json.dumps(CLOUD)})")
    except Exception as e:
        r = "throw:" + str(e)[:60]
    check(f"{L} M34[D] 首次下載寫失敗 ⇒ 不公布（D 仍無、記憶體仍空）", RAW(pg) is None and MST(pg)["it"] == {}, r)
    ctx.close()
    ctx, pg = one(br, seed=v1({A_["id"]: ent()}))
    do_reset(pg)
    r = pg.evaluate(f"window.__propose({json.dumps(CLOUD)})"); pg.wait_for_timeout(300)
    check(f"{L} M34[D] 清除後雲端再提出舊資料 ⇒ 拒絕、不復活", DIT(pg) == {} and RAW(pg) != CLOUD, (r, DIT(pg)))
    ctx.close()


MATRIX = [m01_02, m03, m04, m05, m06, m07, m08, m09, lambda b, L: m12_13(b, L, False), lambda b, L: m12_13(b, L, True), m14, m15, m16,
          m17, m18, m19, m20, m21, m22, m23, m24, m25, m26, m27, m28, m29, m30, m31, m32, m33, m34, mc6, mf2, mf3, mf3b]


def run_matrix(br, L):
    for f in MATRIX:
        try:
            f(br, L)
        except Exception as e:
            check(f"{L} {getattr(f, '__name__', 'm')} 執行例外", False, repr(e)[:300])


def safe(f, *a):
    try:
        f(*a)
    except Exception as e:
        check(f"{getattr(f, '__name__', 'flow')} {' '.join(x for x in a if isinstance(x, str))} 執行例外", False, repr(e)[:300])


def main():
    with sync_playwright() as p:
        cr = p.chromium.launch()
        if ONLY != "M":
            safe(flow_empty, cr, "桌機", {"viewport": {"width": 1280, "height": 900}})
            safe(flow_practice, cr, "桌機", {"viewport": {"width": 1280, "height": 900}})
            safe(flow_practice, cr, "手機390", {"viewport": {"width": 390, "height": 844}, "is_mobile": True, "has_touch": True, "device_scale_factor": 2})
            safe(flow_master, cr)
            safe(flow_hide_reset, cr, "桌機", {"viewport": {"width": 1280, "height": 900}})
            safe(flow_codex_151f6f09, cr)
            safe(flow_codex_cf61e0ff, cr)
            safe(flow_upload, cr)
        run_matrix(cr, "CR")
        cr.close()
        wk = p.webkit.launch()
        ipad = p.devices["iPad (gen 7)"]
        if ONLY != "M":
            safe(flow_empty, wk, "iPad", ipad)
            safe(flow_practice, wk, "iPad", ipad)
            safe(flow_hide_reset, wk, "iPad", ipad)
        run_matrix(wk, "WK")
        wk.close()
    bad = [r for r in RESULTS if not r[1]]
    print(f"\n{len(RESULTS) - len(bad)}/{len(RESULTS)} PASS")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
