#!/usr/bin/env python3
"""各科 app 待加強（#3016）e2e：設計書 docs/app-weak-entry-design-20261019.md 第 6 節 E1–E9。
用 python3.12 執行：python3.12 tests/e2e_appweak.py [--root 其他版本的目錄]
・四個科目站的 weak-export.js 換成**合成替身**（FAKE_EXPORT）：存檔是合成的科目存檔形狀（cards／log／days），
  替身照「做過且沒有有效日或待確認＝待加強；RETIRED 標 out／challenge 的另算；今天練過的不算今天可練」算題數。
  替身只是測試用的科目站；錯題站要驗的是「照科目站的函式顯示、不抄判準、量不到不顯示 0、out 不列、只讀不寫」。
・家庭同步雲端用 route 換成記憶體假後端（照 g5-help/gas/core.js handle() 的 get 回應）。測試資料不放真實姓名、學校。"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import e2e  # noqa: E402  共用 route／init／作答工具（--root 同樣適用）
from e2e import check, new_ctx, page_in, ITEMS, GAS  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

SUBJ = [("g5sci.v3", "自然", "g5-sci-review"), ("g5math.v2", "數學", "g5-math-review"),
        ("g5chi.v1", "國語", "g5-chinese-review"), ("g5soc.v1", "社會", "g5-social-review")]
HOME = {k: f"https://windsorya.github.io/{site}/" for k, _, site in SUBJ}
CODE = "ABCDEFGHJKMN"
T = 1792382400000            # 2026-10-19 12:00 台北（固定時鐘；node 算：Date.UTC(2026,9,19,4)）
TODAY = "2026-10-19"

# 合成替身：{{KEY}}、{{KIND}}、{{LINKS}}、{{EXTRA}} 由各測試換掉
FAKE_EXPORT = r"""
(function(){
  var KIND = {{KIND}};
  function day(ms){ var d = new Date(ms + 8 * 3600000); return d.toISOString().slice(0, 10); }
  window.G5WeakExport = window.G5WeakExport || {};
  window.G5WeakExport[{{KEY}}] = { api: 1, key: {{KEY}}, links: {{LINKS}},
    summarize: function (raw, now) {
      var o = JSON.parse(raw);
      if (!o || o.v !== 4 || typeof o.cards !== "object") return { ok: false };
      var t = day(now), touched = (o.days && o.days[t] && o.days[t].touched) || [], r = { ok: true, answers: (o.log || []).length, seen: 0, weak: 0, weakToday: 0, challenge: 0, challengeToday: 0, out: 0 };
      Object.keys(o.cards).forEach(function (id) {
        var c = o.cards[id]; r.seen += c.seen;
        if (!(c.seen > 0 && (!c.goodDays.length || c.needsRecheck))) return;
        var k = KIND[id] === "out" ? "out" : KIND[id] === "challenge" ? "challenge" : "weak", now2 = touched.indexOf(id) < 0;
        if (k === "out") { r.out++; return; }
        r[k]++; if (now2) r[k + "Today"]++;
      });
      return r;
    } };
  {{EXTRA}}
})();
"""


def fake_export(key, kind=None, links=None, extra=""):
    js = FAKE_EXPORT.replace("{{KEY}}", json.dumps(key)).replace("{{KIND}}", json.dumps(kind or {}))
    return js.replace("{{LINKS}}", json.dumps(links or {"weak": None, "challenge": None})).replace("{{EXTRA}}", extra)


def card(seen=1, good=0, recheck=False):
    c = {"seen": seen, "goodDays": ["2026-10-1%d" % i for i in range(good)], "blockedDay": None, "due": None}
    if recheck:
        c["needsRecheck"] = True
    return c


def subject_save(cards, log=None, touched=None):
    """合成的科目存檔（形狀像科目站 v4：cards／log／days）。"""
    return json.dumps({"v": 4, "cards": cards, "log": [{"d": TODAY, "card": x} for x in (log or [])],
                       "days": {TODAY: {"touched": touched or []}}}, ensure_ascii=False)


# 自然：範圍內待加強 3（s1 今天練過 ⇒ 今天可練 2）、挑戰 1（k8）、考不到 1（k9）、已會 1（s4）
SCI = subject_save({"s1": card(), "s2": card(2), "s3": card(1, 1, True), "s4": card(2, 2), "k8": card(), "k9": card()},
                   log=["s1", "s2", "s3", "s4", "k8", "k9"], touched=["s1"])
SCI_KIND = {"k8": "challenge", "k9": "out", "k10": "out"}
MATH = subject_save({"m1": card(1, 1)}, log=["m1"])                 # 練過、都會 ⇒ 0 題
CHI = subject_save({"c1": card(), "c2": card()}, log=["c1", "c2"])   # 2 題
SOC = subject_save({"o1": card()}, log=["o1"])                       # 只有一題且是 out ⇒ 0 題
SOC_KIND = {"o1": "out"}


def gas_backend(rows, sent, down=False):
    """rows：{key: (rev, data, updated)}；sent 收集請求。"""
    def handle(route):
        try:
            req = json.loads(route.request.post_data or "{}")
        except Exception:
            req = {}
        sent.append(req)
        if down:
            return route.abort("internetdisconnected")
        if req.get("op") != "get":
            return route.fulfill(status=200, content_type="application/json", body=json.dumps({"ok": False, "err": "bad-op"}))
        rev, data, upd = rows.get(req.get("key"), (0, None, None))
        route.fulfill(status=200, content_type="application/json", headers={"access-control-allow-origin": "*"},
                      body=json.dumps({"ok": True, "rev": rev, "data": data, "updated": upd}))
    return handle


def serve_js(js):
    return lambda route: route.fulfill(status=200, content_type="application/javascript", body=js)


def open_aw(br, device=None, local=None, exports=None, code=None, auto=False, cloud=None, down=False, items=None, flags="", gas=False):
    """local：{key: raw}；exports：{key: js}（沒列的科目＝404）；cloud：{key: (rev, data, updated)}。"""
    once = "".join(f"window.__rawSet({json.dumps(k)}, {json.dumps(v)});" for k, v in (local or {}).items())
    if auto:
        once += f"window.__rawSet('g5sync.auto', {json.dumps(CODE)});"
    fl = f"window.__T = {T};" + ("if (window.__rawGet('__aw') === null) { window.__rawSet('__aw', '1');" + once + "}" if once else "") + flags
    ctx = new_ctx(br, device, items=[] if items is None else items, code=code, flags=fl)
    for k, js in (exports or {}).items():
        site = HOME[k].rstrip("/").rsplit("/", 1)[1]
        ctx.route(f"https://windsorya.github.io/{site}/weak-export.js", serve_js(js))
    sent = []
    if code or gas:
        ctx.route(GAS, gas_backend(cloud or {}, sent, down))
    pg = page_in(ctx)
    pg.__sent = sent
    settle(pg)
    return ctx, pg


def settle(pg, secs=10):
    try:
        pg.wait_for_function("(() => { const r = document.querySelectorAll('#awRows .aw'); return r.length === 4 && ![...r].some(x => x.dataset.state === 'loading'); })()", timeout=secs * 1000)
    except Exception:
        pass


def rows(pg):
    return pg.evaluate("""[...document.querySelectorAll('#awRows .aw')].map(r => ({key: r.dataset.key, state: r.dataset.state,
        text: r.querySelector('.aws').textContent, src: (r.querySelector('.awsrc') || {}).textContent || '',
        href: r.querySelector('a').getAttribute('href'), label: r.querySelector('a').textContent,
        hint: (r.querySelector('.awhint') || {}).textContent || ''}))""")


def row(pg, key):
    return next(r for r in rows(pg) if r["key"] == key)


def aw_text(pg):
    return pg.locator("#appWeak").inner_text()


def subject_raw(pg):
    return pg.evaluate("[" + ",".join(f"window.__rawGet({json.dumps(k)})" for k, _, _ in SUBJ) + "]")


def errs(pg):
    return pg.__errors


ALL4 = {"g5sci.v3": SCI, "g5math.v2": MATH, "g5chi.v1": CHI, "g5soc.v1": SOC}
EXP4 = {"g5sci.v3": fake_export("g5sci.v3", SCI_KIND), "g5math.v2": fake_export("g5math.v2"),
        "g5chi.v1": fake_export("g5chi.v1"), "g5soc.v1": fake_export("g5soc.v1", SOC_KIND)}


def e1_e2(br, L, device=None):
    ctx, pg = open_aw(br, device, local=ALL4, exports=EXP4)
    before = subject_raw(pg)
    r = {x["key"]: x for x in rows(pg)}
    check(f"{L} E1 自然：範圍內待加強 3、今天可練 2（照科目站函式）", r["g5sci.v3"]["text"] == "待加強 3 題（今天可以練 2 題，其餘今天練過了）", r["g5sci.v3"])
    check(f"{L} E1 數學：讀到紀錄、函式算出 0 ⇒「沒有待加強的題」", r["g5math.v2"]["text"] == "沒有待加強的題", r["g5math.v2"])
    check(f"{L} E1 國語：2 題", r["g5chi.v1"]["text"] == "待加強 2 題", r["g5chi.v1"])
    check(f"{L} E1 來源：依這台裝置的紀錄（沒有家庭碼）", all(x["src"] == "依這台裝置的紀錄" for x in r.values()), [x["src"] for x in r.values()])
    total = pg.locator("#awTotal").inner_text()
    check(f"{L} E1 總數＝3＋0＋2＋0＝5", total == "各科 app 待加強共 5 題", total)
    # E2：自然 out 1 題、社會唯一的題是 out ⇒ 都不出現、不加總；挑戰 1 題在考古挑戰區、不加進總數
    check(f"{L} E2 out 不列：社會只有一題 out ⇒「沒有待加強的題」", r["g5soc.v1"]["text"] == "沒有待加強的題", r["g5soc.v1"])
    check(f"{L} E2 out 不列：整區沒有「考不到」字樣、總數不是含 out 的 7", "考不到" not in aw_text(pg) and "共 7 題" not in total, aw_text(pg)[:300])
    ch = pg.locator("#awChRows").inner_text()
    check(f"{L} E2 考古挑戰區只列自然 1 題（可選、標示較難）", not pg.locator("#awCh").is_hidden() and "自然" in ch and "考古挑戰 1 題" in ch and "社會" not in ch and "比較難" in aw_text(pg), ch)
    # E5（沒有 links）：連首頁＋說明
    s = r["g5sci.v3"]
    check(f"{L} E5 沒有直接開練網址 ⇒ 按鈕「去自然站」連首頁＋說明", s["href"] == HOME["g5sci.v3"] and s["label"] == "去自然站" and "練待加強的" in s["hint"], s)
    check(f"{L} E5 數學 0 題不放說明", r["g5math.v2"]["hint"] == "" and r["g5math.v2"]["href"] == HOME["g5math.v2"], r["g5math.v2"])
    # I1：重新讀取後四個科目 key 逐字不變
    pg.locator("#awReload").click(); pg.wait_for_timeout(300); settle(pg)
    check(f"{L} I1 四個科目 key 讀前讀後逐字相同（只讀不寫）", subject_raw(pg) == before == [SCI, MATH, CHI, SOC], subject_raw(pg))
    check(f"{L} E8 沒有 JS 錯誤", not errs(pg), errs(pg))
    check(f"{L} E9 不橫向捲動", e2e.no_overflow(pg))
    ctx.close()


def e3(br, L):
    ctx, pg = open_aw(br, local=ALL4)   # 沒有任何 export（404）
    r = rows(pg)
    check(f"{L} E3a 檔案 404 ⇒ 四科都「量不到：○○站還沒提供」", all(x["state"] == "na" and x["text"].startswith("量不到：") and "還沒提供" in x["text"] for x in r), r)
    t = aw_text(pg)
    check(f"{L} E3a 整區沒有任何「0 題」、總數說量不到", not re.search(r"(?<!\d)0 題", t) and pg.locator("#awTotal").inner_text() == "各科題數都還量不到", t[:300])
    check(f"{L} E3a 量不到也有前往按鈕", all(x["href"] == HOME[x["key"]] for x in r), r)
    ctx.close()

    ctx, pg = open_aw(br, exports=EXP4)   # 有 export、沒有本機紀錄、沒有家庭碼
    r = row(pg, "g5sci.v3")
    check(f"{L} E3b 本機沒有＋沒家庭碼 ⇒ 量不到：也還沒開跨裝置同步", r["text"] == "量不到：這台裝置沒有自然站的紀錄，也還沒開跨裝置同步", r)
    check(f"{L} E3b 沒有家庭碼 ⇒ 不送任何雲端請求", pg.__sent == [], pg.__sent)
    ctx.close()

    ctx, pg = open_aw(br, exports=EXP4, code=CODE, cloud={})   # 雲端 rev 0
    r = row(pg, "g5sci.v3")
    check(f"{L} E3c 雲端 rev 0 ⇒ 量不到：這台和雲端都還沒有", r["text"] == "量不到：這台和雲端都還沒有自然站的紀錄", r)
    ctx.close()
    ctx, pg = open_aw(br, exports=EXP4, code=CODE, cloud={}, auto=True)
    r = row(pg, "g5sci.v3")
    check(f"{L} E3c 自動開的同步還沒連上 ⇒ 提醒貼家裡的連結", "還沒跟家裡其他裝置連上" in r["text"], r)
    ctx.close()

    ctx, pg = open_aw(br, exports=EXP4, code=CODE, down=True)
    r = row(pg, "g5sci.v3")
    check(f"{L} E3d 雲端連不上 ⇒ 量不到：雲端暫時讀不到", r["text"] == "量不到：這台裝置沒有自然站的紀錄，雲端暫時讀不到（可能沒有網路）", r)
    ctx.close()

    ctx, pg = open_aw(br, local={"g5sci.v3": json.dumps({"v": 99})}, exports=EXP4)
    r = row(pg, "g5sci.v3")
    check(f"{L} E3e 紀錄被科目站函式判讀不懂 ⇒ 量不到：讀不懂", r["text"] == "量不到：自然站的紀錄讀不懂", r)
    ctx.close()

    # E3h：這一頁裡才開同步（沒有 storage 事件）⇒ 家庭碼一出現就改讀雲端
    ctx, pg = open_aw(br, exports=EXP4, gas=True, cloud={"g5sci.v3": (3, SCI, 1792375600000)})
    before = row(pg, "g5sci.v3")["text"]
    pg.evaluate(f"window.__rawSet('g5sync.code', {json.dumps(CODE)})")
    try:
        pg.wait_for_function("document.querySelector('#awRows .aw[data-key=\"g5sci.v3\"] .aws').textContent.indexOf('待加強 3 題') === 0", timeout=9000)
        ok = True
    except Exception:
        ok = False
    check(f"{L} E3h 同一頁開了同步（家庭碼出現）⇒ 不用重新整理就改讀雲端", "也還沒開跨裝置同步" in before and ok, (before, row(pg, "g5sci.v3")))
    ctx.close()

    bad = dict(EXP4)
    bad["g5sci.v3"] = fake_export("g5sci.v3", extra="window.G5Tones = {fake: true};")
    bad["g5math.v2"] = fake_export("g5soc.v1")   # 註冊到別科的 key
    ctx, pg = open_aw(br, local=ALL4, exports=bad)
    r = {x["key"]: x for x in rows(pg)}
    check(f"{L} E3f 換掉錯題站全域的檔 ⇒ 格式不對，全域換回原物件", r["g5sci.v3"]["text"] == "量不到：自然站提供的題數資料格式不對" and pg.evaluate("!!(window.G5Tones && window.G5Tones.TONES && !window.G5Tones.fake)"), r["g5sci.v3"])
    check(f"{L} E3g 註冊錯 key 的檔 ⇒ 格式不對", r["g5math.v2"]["text"] == "量不到：數學站提供的題數資料格式不對", r["g5math.v2"])
    check(f"{L} E3 有一科量不到 ⇒ 總數註明沒算進去", "量不到，沒算進去" in pg.locator("#awTotal").inner_text(), pg.locator("#awTotal").inner_text())
    ctx.close()


def e4(br, L):
    up = 1792375600000   # 10/19 10:06:40 台北（node 算：Date.UTC(2026,9,19,2,6,40)）
    ctx, pg = open_aw(br, exports=EXP4, code=CODE, cloud={"g5sci.v3": (7, SCI, up)})
    r = row(pg, "g5sci.v3")
    check(f"{L} E4a 本機沒有、雲端有 ⇒ 用雲端並標上傳時間", r["text"].startswith("待加強 3 題") and r["src"] == "依雲端紀錄（10/19 10:06 上傳）", r)
    gets = [s for s in pg.__sent if s.get("op") == "get"]
    check(f"{L} E4a 雲端請求＝四科各一次 get、帶家庭碼", sorted(s["key"] for s in gets) == sorted(k for k, _, _ in SUBJ) and all(s.get("code") == CODE for s in gets), gets)
    check(f"{L} I1 雲端請求只有 get", all(s.get("op") == "get" for s in pg.__sent), pg.__sent)
    ctx.close()
    # 兩份都有：雲端練得多（作答 7 筆 vs 本機 1 筆）⇒ 用雲端；本機練得多 ⇒ 用本機
    small = subject_save({"s1": card()}, log=["s1"])
    ctx, pg = open_aw(br, local={"g5sci.v3": small}, exports=EXP4, code=CODE, cloud={"g5sci.v3": (7, SCI, up)})
    r = row(pg, "g5sci.v3")
    check(f"{L} E4b 兩份都有、雲端練得多 ⇒ 用雲端那份", r["text"].startswith("待加強 3 題") and r["src"].startswith("依雲端紀錄"), r)
    check(f"{L} E4b 選雲端只是顯示，本機紀錄不被改", pg.evaluate("window.__rawGet('g5sci.v3')") == small)
    ctx.close()
    ctx, pg = open_aw(br, local={"g5sci.v3": SCI}, exports=EXP4, code=CODE, cloud={"g5sci.v3": (7, small, up)})
    r = row(pg, "g5sci.v3")
    check(f"{L} E4c 兩份都有、本機練得多 ⇒ 用本機", r["text"].startswith("待加強 3 題") and r["src"] == "依這台裝置的紀錄", r)
    ctx.close()


def e5_links(br, L):
    ok = {"weak": HOME["g5sci.v3"] + "#go=weak", "challenge": HOME["g5sci.v3"] + "#go=challenge"}
    exps = dict(EXP4)
    exps["g5sci.v3"] = fake_export("g5sci.v3", SCI_KIND, ok)
    exps["g5chi.v1"] = fake_export("g5chi.v1", links={"weak": "https://windsorya.github.io/g5-math-review/#go=weak", "challenge": None})
    ctx, pg = open_aw(br, local=ALL4, exports=exps)
    s, c = row(pg, "g5sci.v3"), row(pg, "g5chi.v1")
    check(f"{L} E5 有直接開練網址 ⇒ 按鈕「直接練自然待加強的」連那個網址、不放說明", s["href"] == ok["weak"] and s["label"] == "直接練自然待加強的" and s["hint"] == "", s)
    chh = pg.evaluate("document.querySelector('#awChRows a').getAttribute('href')")
    check(f"{L} E5 考古挑戰按鈕連 links.challenge", chh == ok["challenge"], chh)
    check(f"{L} E5 別站網址不採用 ⇒ 國語仍連國語站首頁", c["href"] == HOME["g5chi.v1"] and c["label"] == "去國語站", c)
    ctx.close()


def e6_practice(br, L):
    it = ITEMS[0]
    ctx, pg = open_aw(br, local=ALL4, exports=EXP4, items=[it])
    order = pg.evaluate("[...document.querySelectorAll('.wrap > *')].map(e => e.id).filter(Boolean)")
    check(f"{L} E6 順序：①學校小考錯題（#main）在 ②各科 app 待加強（#appWeak）前面", order.index("main") < order.index("appWeak"), order)
    pg.locator("#goToday").click()
    pg.wait_for_selector("#qText")
    check(f"{L} E6 練習中藏起來（先專心練完）", pg.locator("#appWeak").is_hidden())
    pg.locator("#quit").click()
    pg.wait_for_selector("#goToday")
    check(f"{L} E6 回首頁再出現", pg.locator("#appWeak").is_visible())
    ctx.close()


def e7_storage(br, L):
    ctx, pg = open_aw(br, local=ALL4, exports=EXP4)
    other = ctx.new_page()
    other.goto("https://g5wrong.test/robots.txt")
    more = subject_save({"c1": card(), "c2": card(), "c3": card()}, log=["c1", "c2", "c3"])
    other.evaluate(f"localStorage.setItem('g5chi.v1', {json.dumps(more)})")
    try:
        pg.wait_for_function("document.querySelector('#awRows .aw[data-key=\"g5chi.v1\"] .aws').textContent === '待加強 3 題'", timeout=5000)
        ok = True
    except Exception:
        ok = False
    check(f"{L} E7 同瀏覽器別的分頁練了國語 ⇒ 這頁題數跟著更新", ok, row(pg, "g5chi.v1"))
    ctx.close()


def e9_layout(br, L):
    for w in (390, 320):
        ctx, pg = open_aw(br, {"viewport": {"width": w, "height": 800}, "is_mobile": True, "has_touch": True}, local=ALL4, exports={})
        check(f"{L} E9 {w}px 量不到的長句也不橫向捲動", e2e.no_overflow(pg))
        ctx.close()


def safe(f, *a):
    try:
        f(*a)
    except Exception as e:
        check(f"{getattr(f, '__name__', 'flow')} {' '.join(x for x in a if isinstance(x, str))} 執行例外", False, repr(e)[:300])


def main():
    with sync_playwright() as p:
        cr = p.chromium.launch()
        for f in (e1_e2, e3, e4, e5_links, e6_practice, e7_storage, e9_layout):
            safe(f, cr, "CR")
        cr.close()
        wk = p.webkit.launch()
        ipad = p.devices["iPad (gen 7)"]
        safe(e1_e2, wk, "WK-iPad", ipad)
        for f in (e3, e4, e6_practice):
            safe(f, wk, "WK")
        wk.close()
    bad = [r for r in e2e.RESULTS if not r[1]]
    print(f"\n{len(e2e.RESULTS) - len(bad)}/{len(e2e.RESULTS)} PASS")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
