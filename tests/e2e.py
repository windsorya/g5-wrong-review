#!/usr/bin/env python3
"""錯題複習 e2e：本機 index.html（或 --base 正式網址）；Chromium 桌機／手機 390、WebKit iPad。
用 python3.12 執行：python3.12 tests/e2e.py [--base https://windsorya.github.io/g5-wrong-review/]
題庫還是空的時候也要驗得到練習流程 ⇒ 用 window.G5WrongTestItems 在頁面載入前放測試題（正式網頁不會有這個變數）。
上傳不真的送到家裡的 GAS：page.route 攔下來回假資料，檢查送出去的內容。"""
import base64
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
BASE = sys.argv[sys.argv.index("--base") + 1].rstrip("/") + "/" if "--base" in sys.argv else ROOT.as_uri() + "/"
URL = BASE + "index.html"
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
BAD = {"id": "w-bad", "subject": "體育", "source": "x", "added": "2026-10-10", "type": "tf", "q": "壞題", "a": True, "why": "壞"}
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")


def check(name, cond, detail=""):
    RESULTS.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  ← {detail}"))


def open_page(browser, device=None, items=None, state=None, code=None, label=""):
    ctx = browser.new_context(**(device or {}))
    init = ""
    if items is not None:
        init += f"window.G5WrongTestItems = {json.dumps(items, ensure_ascii=False)};"
    # state／code 只在第一次載入時放（重新整理後要讀到頁面自己存的）
    if state is not None or code:
        init += ("if(!sessionStorage.getItem('seeded')){sessionStorage.setItem('seeded','1');"
                 + (f"localStorage.setItem('g5wrong.v1', {json.dumps(json.dumps(state))});" if state is not None else "")
                 + (f"localStorage.setItem('g5sync.code', {json.dumps(code)});" if code else "") + "}")
    if init:
        ctx.add_init_script(init)
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL)
    page.wait_for_selector("#main .btn, #main .empty")
    return ctx, page, errors


def no_overflow(page):
    return page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")


def nav(page):
    return page.evaluate("[...document.querySelectorAll('#siteNav a, #siteNav [aria-current]')].map(e=>[e.textContent.trim(), e.getAttribute('href'), e.getAttribute('aria-current')])")


def today(page):
    return page.evaluate("G5WrongCore.dayKey(Date.now())")


def cur_item(page):
    q = page.locator("#qText").inner_text()
    return next(i for i in ITEMS if i["q"] == q)


def answer(page, right):
    it = cur_item(page)
    if it["type"] == "choice":
        k = it["a"] if right else (it["a"] + 1) % len(it["opts"])
        page.locator(f'#main .opt[data-k="{k}"]').click()
    elif it["type"] == "tf":
        k = 0 if (it["a"] if right else not it["a"]) else 1
        page.locator(f'#main .opt[data-k="{k}"]').click()
    else:
        page.fill("#fillIn", it["a"][-1] if right else "不知道")
        page.locator("#fillIn").press("Enter")
    page.wait_for_selector("#fb")
    return it


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
    pg.reload(); pg.wait_for_selector("#main .btn")
    check(f"{label} 重新整理後進度還在", pg.locator("#dueN").inner_text() == "0" and pg.evaluate("Object.keys(G5WrongApp.state().it).length") == 3)
    pg.locator("#listBox > summary").click()
    lst =pg.locator("#list").inner_text()
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
    pg.evaluate(f"localStorage.setItem('g5wrong.v1', {json.dumps(json.dumps(st))})")
    pg.reload(); pg.wait_for_selector("#goToday")
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
    pg.reload(); pg.wait_for_selector("#main .btn")
    check(f"{label} 不用再練：重新整理後仍隱藏", pg.locator("#dueN").inner_text() == "2")
    pg.locator("#goToday").click()
    seen = set()
    for _ in range(2):
        seen.add(answer(pg, True)["id"]); pg.locator("#nextBtn").click()
    check(f"{label} 隱藏的題不會出現在今天的複習", ITEMS[0]["id"] not in seen and pg.locator("#main .done").count() == 1, seen)
    pg.locator("#homeBtn").click()
    if not pg.locator("#listBox").evaluate("e=>e.open"):
        pg.locator("#listBox > summary").click()
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
    check(f"{label} 確定清除：作答紀錄歸零、隱藏名單保留、今天要練回到 2", s["it"] == {} and [k for k, v in s["hidden"].items() if v is True or v > 0] == [ITEMS[1]["id"]] and pg.locator("#dueN").inner_text() == "2", s)
    pg.reload(); pg.wait_for_selector("#main .btn")
    check(f"{label} 清除後重新整理仍是清除狀態", pg.evaluate("Object.keys(G5WrongApp.state().it).length") == 0)
    check(f"{label} 清除／隱藏流程沒有 JS 錯誤", not errors, errors)
    ctx.close()


def flow_codex_151f6f09(browser):
    """Codex 審 151f6f09 抓到的四個反例，各重現一次。"""
    # ①兩個分頁同時練：A 答兩題、B 再答一題，三題紀錄都要在；A 清除後 B 作答不可把舊紀錄寫回
    ctx = browser.new_context()
    ctx.add_init_script(f"window.G5WrongTestItems = {json.dumps(ITEMS, ensure_ascii=False)};")
    a, b = ctx.new_page(), ctx.new_page()
    errs = []
    for p in (a, b):
        p.on("pageerror", lambda e: errs.append(str(e)))
        p.goto(URL); p.wait_for_selector("#goToday")
    # A 練自然（1 題）；B 練全部科目（數學→國語→自然，照加入日）。兩頁都在載入時拿到空紀錄。
    a.locator('#main .sub[data-sub="自然"]').click(); b.locator('#main .sub[data-sub=""]').click()
    ids = {answer(a, True)["id"]}
    ids.add(answer(b, True)["id"])
    saved = a.evaluate("Object.keys(JSON.parse(localStorage.getItem('g5wrong.v1')).it).sort()")
    check("兩分頁同時練：兩頁各答的題紀錄都在（不互相覆蓋）", saved == sorted(ids) and len(saved) == 2, saved)
    a.locator("#nextBtn").click(); a.locator("#homeBtn").click()
    a.locator("#setBox summary").click(); a.locator("#resetBtn").click(); a.locator("#resetYes").click()
    b.locator("#nextBtn").click()
    if b.locator("#qText").count():
        last = answer(b, True)["id"]
        saved = a.evaluate("Object.keys(JSON.parse(localStorage.getItem('g5wrong.v1')).it)")
        check("A 清除後 B 再作答：只多 B 這一題，舊紀錄沒有復活", saved == [last], saved)
    else:
        check("A 清除後 B 再作答：只多 B 這一題，舊紀錄沒有復活", False, "B 沒有下一題可答")
    check("兩分頁流程沒有 JS 錯誤", not errs, errs)
    ctx.close()
    # ②練習中把下一題設成不用再練：不再出現
    ctx, pg, errors = open_page(browser, items=ITEMS)
    pg.locator("#goToday").click()
    order = pg.evaluate("G5WrongCore.dueList(G5WrongTestItems.map(x=>x), {v:1,it:{},hidden:{}}, G5WrongCore.dayKey(Date.now())).map(x=>x.id)")
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
    pg.locator("#setBox summary").click(); pg.locator("#resetBtn").click(); pg.locator("#resetYes").click()
    msg = pg.locator("#resetMsg").inner_text()
    check("清除存不進去：照實說沒成功、畫面紀錄維持原樣", "沒有清除成功" in msg and pg.evaluate("Object.keys(G5WrongApp.state().it).length") == 1, msg)
    ctx.close()
    # ④學會的題當天又做錯：不可說「不影響進度」
    t = None
    ctx, pg, errors = open_page(browser, items=ITEMS[:1])
    t = today(pg)
    st = {"v": 1, "it": {ITEMS[0]["id"]: {"n": 3, "ok": 3, "bad": 0, "s": 3, "m": True, "last": t, "due": t, "log": []}}, "hidden": {}, "settings": {"sound": False, "tone": 0}}
    pg.evaluate(f"localStorage.setItem('g5wrong.v1', {json.dumps(json.dumps(st))})")
    pg.reload(); pg.wait_for_selector("#goToday")
    pg.locator("#goToday").click(); answer(pg, False)
    fb = pg.locator("#fb").inner_text()
    check("學會的題當天又做錯：不顯示「只算練習」、取消學會", "只算練習" not in fb and pg.evaluate(f"G5WrongApp.state().it['{ITEMS[0]['id']}'].m") is False, fb)
    ctx.close()


def flow_codex_cf61e0ff(browser):
    """Codex 審 cf61e0ff 的反例（真瀏覽器）。"""
    # ①存不進去時答 a、b，恢復後答 c ⇒ a、b、c 都在
    ctx, pg, errors = open_page(browser, items=ITEMS)
    pg.evaluate("() => { window.__realSet = Storage.prototype.setItem; Storage.prototype.setItem = function(){ throw new DOMException('full', 'QuotaExceededError'); }; }")
    pg.locator('#main .sub[data-sub=""]').click()
    ids = [answer(pg, True)["id"]]; pg.locator("#nextBtn").click()
    ids.append(answer(pg, True)["id"]); pg.locator("#nextBtn").click()
    pg.evaluate("() => { Storage.prototype.setItem = window.__realSet; }")
    ids.append(answer(pg, True)["id"])
    saved = pg.evaluate("Object.keys(JSON.parse(localStorage.getItem('g5wrong.v1')).it).sort()")
    check("存不進去期間答的 2 題：恢復後再答 1 題，3 題都存進去", saved == sorted(ids), (saved, ids))
    check("存檔失敗流程沒有 JS 錯誤", not errors, errors)
    ctx.close()
    # ②另一分頁把這頁正在出的題設成不用再練 ⇒ 這頁跳過、不記錄
    ctx = browser.new_context()
    ctx.add_init_script(f"window.G5WrongTestItems = {json.dumps(ITEMS, ensure_ascii=False)};")
    a, b = ctx.new_page(), ctx.new_page()
    for p in (a, b):
        p.goto(URL); p.wait_for_selector("#goToday")
    a.locator('#main .sub[data-sub=""]').click()
    cur = cur_item(a)["id"]
    b.locator("#listBox > summary").click(); b.locator(f'[data-hide="{cur}"]').click()
    a.wait_for_timeout(300)
    now = cur_item(a)["id"] if a.locator("#qText").count() else None
    if now == cur:   # 事件還沒到也要擋：按下作答時重讀才發現
        k = 0
        a.locator(f'#main .opt[data-k="{k}"], #fillGo').first.click()
    s = a.evaluate("JSON.parse(localStorage.getItem('g5wrong.v1'))")
    check("別頁隱藏目前這題：這頁跳過、不記錄", cur not in s.get("it", {}) and (a.locator("#qText").count() == 0 or cur_item(a)["id"] != cur), (cur, now, list(s.get("it", {}))))
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


def main():
    with sync_playwright() as p:
        cr = p.chromium.launch()
        flow_empty(cr, "桌機", {"viewport": {"width": 1280, "height": 900}})
        flow_practice(cr, "桌機", {"viewport": {"width": 1280, "height": 900}})
        flow_practice(cr, "手機390", {"viewport": {"width": 390, "height": 844}, "is_mobile": True, "has_touch": True, "device_scale_factor": 2})
        flow_master(cr)
        flow_hide_reset(cr, "桌機", {"viewport": {"width": 1280, "height": 900}})
        flow_codex_151f6f09(cr)
        flow_codex_cf61e0ff(cr)
        flow_upload(cr)
        cr.close()
        wk = p.webkit.launch()
        ipad = p.devices["iPad (gen 7)"]
        flow_empty(wk, "iPad", ipad)
        flow_practice(wk, "iPad", ipad)
        flow_hide_reset(wk, "iPad", ipad)
        wk.close()
    bad = [r for r in RESULTS if not r[1]]
    print(f"\n{len(RESULTS) - len(bad)}/{len(RESULTS)} PASS")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
