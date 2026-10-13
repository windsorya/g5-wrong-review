#!/usr/bin/env python3
"""跨裝置同步整合 e2e（Codex 審 1ed44f8 F1 的證據）：頁面載入「真的」sync.js，只有 GAS 端點換成記憶體假後端。
用 python3.12 執行：python3.12 tests/e2e_sync.py [--root 其他版本的目錄] [--sync live]
・sync.js 預設用固定版本 tests/vendor/g5-help-sync.js：g5-help 已提交版（協調視窗以 git show 匯出，sha256 40c30e73…，下方 PIN_SHA 執行時核對），
  route 到正式網址 https://windsorya.github.io/g5-help/sync.js；加 --sync live 則不攔、改載正式網址那份（需要網路）。
・假後端照 g5-help/gas/core.js 的 handle()：get 回 {ok, rev, data, updated}（rev 0＝雲端沒有資料）；
  put 帶 rev，等於目前 rev 才寫入並 rev+1，否則回 {ok:false, err:'conflict'} 加目前內容。down＝True 時連線中斷（route.abort）。
・已提交版 sync.js 的 recover()（tests/vendor/g5-help-sync.js 426–462 行）只在兩種情況呼叫 replaceLocal → canReplace／accept：
  ①沒有 baseline 且本機 key 為 null（448–449，真正首次下載）；②有 baseline、沒有 pending、cloud.rev > baseline.rev 且本機自上次同步後沒改（456–457）。
  本機有未上傳的改動（含清除後）一律 startPending（445、461）或 showConflict（450、458）。下面四個情境逐一驗證。
"""
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import e2e  # noqa: E402  共用 route／init／作答等工具（--root 同樣適用）
from e2e import check, A_, B_, C_, ent, v2, RAW, DIT, MST, try_answer, do_reset  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

PIN = Path(__file__).resolve().parent / "vendor" / "g5-help-sync.js"
PIN_SHA = "40c30e73a42da39cab805cbfcff6e23e75909518ffb231d58a0c2d2ddb35f183"
SYNC = "live" if e2e.arg("--sync") == "live" else str(PIN)
CODE = "ABCDEFGHJKMN"
KEY = "g5wrong.v1"
KEYS = ["g5sci.v3", "g5help.v1", "g5math.v1", "g5math.v2", "g5chi.v1", "g5soc.v1", "g5wrong.v1"]
ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

# 記下 sync.js 有沒有向頁面要求替換（canReplace／accept 的每次結果）。頁面一設定 window.G5WrongApp 就包上計數。
SPY = r"""
(() => { let app; window.__acceptCalls = []; window.__canCalls = [];
  Object.defineProperty(window, 'G5WrongApp', { configurable: true, get() { return app; }, set(v) {
    if (v && typeof v.accept === 'function' && typeof v.canReplace === 'function') {
      const a = v.accept, c = v.canReplace;
      v.accept = function (k, d) { const r = a(k, d); window.__acceptCalls.push(r); return r; };
      v.canReplace = function (k) { const r = c(k); window.__canCalls.push(r); return r; };
    }
    app = v; } }); })();
"""


def integer(n):
    return isinstance(n, int) and not isinstance(n, bool) and 0 <= n < 9007199254740991


class Backend:
    """g5-help/gas/core.js handle() 的記憶體版（只做 ping／get／put；同步碼與 key 檢查照抄）。"""

    def __init__(self):
        self.rows, self.down, self.ops, self.clock = {}, False, [], 1791000000000

    def handle(self, route):
        if self.down:
            return route.abort("internetdisconnected")
        try:
            req = json.loads(route.request.post_data or "null")
        except Exception:
            req = None
        res = self.core(req)
        self.ops.append((req or {}).get("op") if isinstance(req, dict) else None)
        route.fulfill(status=200, content_type="application/json", headers={"access-control-allow-origin": "*"}, body=json.dumps(res))

    def core(self, req):
        if not isinstance(req, dict):
            return {"ok": False, "err": "bad-request"}
        op = req.get("op")
        if op == "ping":
            return {"ok": True, "pong": True}
        if op not in ("get", "put"):
            return {"ok": False, "err": "bad-op"}
        code = req.get("code")
        if not (isinstance(code, str) and len(code) == 12 and all(ch in ALPHABET for ch in code)):
            return {"ok": False, "err": "bad-code"}
        if req.get("key") not in KEYS:
            return {"ok": False, "err": "bad-key"}
        if op == "put":
            if not isinstance(req.get("data"), str):
                return {"ok": False, "err": "bad-data"}
            if len(req["data"]) > 900000:
                return {"ok": False, "err": "too-big"}
            if not integer(req.get("rev")):
                return {"ok": False, "err": "bad-rev"}
        cur = self.rows.get((code, req["key"])) or {"rev": 0, "data": None, "updated": None}
        if op == "get":
            return {"ok": True, "rev": cur["rev"], "data": cur["data"], "updated": cur["updated"]}
        if req["rev"] != cur["rev"]:
            return {"ok": False, "err": "conflict", "rev": cur["rev"], "data": cur["data"], "updated": cur["updated"]}
        self.clock += 1000
        nxt = {"rev": cur["rev"] + 1, "data": req["data"], "updated": self.clock}
        self.rows[(code, req["key"])] = nxt
        return {"ok": True, "rev": nxt["rev"], "updated": nxt["updated"]}

    def other_device_put(self, data):
        """另一台裝置照協定上傳一版（rev+1）。"""
        cur = self.cloud() or {"rev": 0}
        r = self.core({"op": "put", "code": CODE, "key": KEY, "rev": cur["rev"], "data": data})
        assert r["ok"], r

    def cloud(self):
        return self.rows.get((CODE, KEY))


def ctx_for(br, be, seed):
    ctx = e2e.new_ctx(br, items=e2e.ITEMS, seed=seed, code=CODE, flags=SPY, sync=SYNC)
    ctx.route(e2e.GAS, be.handle)   # 後註冊的 route 先處理：GAS 一律進假後端，絕不連到真的 GAS
    return ctx


def wait_until(pg, fn, secs=12):
    for _ in range(int(secs * 10)):
        try:
            if fn():
                return True
        except Exception:
            pass
        pg.wait_for_timeout(100)
    return False


def baseline_rev(pg):
    return pg.evaluate("(() => { try { const c = JSON.parse(window.__rawGet('g5sync.ckpt.g5wrong.v1')); return c && c.baseline ? c.baseline.rev : null; } catch (e) { return null; } })()")


def calls(pg):
    return pg.evaluate("({can: window.__canCalls, acc: window.__acceptCalls})")


def panel(pg):
    return pg.locator("#g5sync").text_content() or ""


def online(pg):
    pg.evaluate("() => { window.dispatchEvent(new Event('online')); }")


def first_sync(pg, be, L, tag):
    ok = wait_until(pg, lambda: be.cloud() is not None and be.cloud()["rev"] == 1 and baseline_rev(pg) == 1)
    check(f"{L} {tag}[前提] 第一次同步：本機上傳成雲端 rev 1、這台 baseline＝rev 1", ok, (be.cloud(), baseline_rev(pg), be.ops))
    return ok


def s1(br, L):
    """(i) 本機有資料、從未同步、雲端有資料 → 不替換、本機保留。"""
    be = Backend()
    local, cloud = v2({A_["id"]: ent(n=2, ok=2)}), v2({C_["id"]: ent(n=7, ok=7)})
    be.other_device_put(cloud)
    ctx = ctx_for(br, be, local)
    pg = e2e.page_in(ctx)
    ok = wait_until(pg, lambda: "get" in be.ops and "兩台的紀錄不一樣" in panel(pg))
    check(f"{L} S1[前提] sync.js 已向假後端 GET，並判定兩台不同（各自保留）", ok, (be.ops, panel(pg)[:200]))
    check(f"{L} S1[D] 本機有資料、從未同步、雲端有資料 ⇒ 不替換：存檔逐字不變、記憶體仍是本機的 a", RAW(pg) == local and A_["id"] in MST(pg)["it"] and C_["id"] not in MST(pg)["it"], RAW(pg))
    check(f"{L} S1[D] 雲端也沒被覆寫（仍是另一台的 rev 1）", be.cloud()["rev"] == 1 and be.cloud()["data"] == cloud, be.cloud())
    check(f"{L} S1[D] sync.js 沒有向頁面要求替換（canReplace／accept 都沒被呼叫）", calls(pg) == {"can": [], "acc": []}, calls(pg))
    ctx.close()


def s2(br, L):
    """(ii) 已同步、本機沒改、雲端被另一台更新 → 換成雲端版（正確的跨裝置行為）。"""
    be = Backend()
    local = v2({A_["id"]: ent(n=2, ok=2)})
    ctx = ctx_for(br, be, local)
    pg = e2e.page_in(ctx)
    if not first_sync(pg, be, L, "S2"):
        return ctx.close()
    other = v2({A_["id"]: ent(n=2, ok=2), C_["id"]: ent(n=4, ok=4)})
    be.other_device_put(other)                       # 另一台練了 c，雲端變 rev 2
    e2e.reload(pg)                                   # 這台重新打開網站
    ok = wait_until(pg, lambda: RAW(pg) == other)
    check(f"{L} S2[D] 已同步、本機沒改、雲端被另一台更新 ⇒ 換成雲端版（存檔＝雲端、記憶體有 c）", ok and MST(pg)["it"].get(C_["id"], {}).get("n") == 4, (RAW(pg), MST(pg)["it"].keys()))
    c = calls(pg)
    check(f"{L} S2[D] 經由頁面寫入：canReplace 通過、accept 回 true，baseline 前進到 rev 2", c["acc"] == [True] and True in c["can"] and baseline_rev(pg) == 2, (c, baseline_rev(pg)))
    bk = pg.evaluate("Object.keys(localStorage).filter(k => k.indexOf('g5sync.backup.g5wrong.v1.') === 0).map(k => window.__rawGet(k))")
    check(f"{L} S2[D] 換上前 sync.js 先備份了這台原本的紀錄", local in bk, bk)
    ctx.close()


def s3(br, L):
    """(iii) 已同步、清除成功（已存）→ 重新載入、雲端仍是清除前的版本 → 上傳清除後的狀態、舊紀錄不復活。"""
    be = Backend()
    local = v2({A_["id"]: ent(n=3, ok=3, s=3, m=True), B_["id"]: ent()})
    ctx = ctx_for(br, be, local)
    pg = e2e.page_in(ctx)
    if not first_sync(pg, be, L, "S3"):
        return ctx.close()
    be.down = True                                   # 清除時連不上雲端：雲端停在清除前的 rev 1
    msg = do_reset(pg)
    check(f"{L} S3[前提] 清除成功且已存在這台", "已清除" in msg and DIT(pg) == {}, (msg, DIT(pg)))
    e2e.reload(pg)                                   # 重新載入（此時仍離線，第一次 GET 失敗）
    pg.wait_for_timeout(300)
    check(f"{L} S3[前提] 重新載入時雲端仍是清除前的版本（rev 1）", be.cloud()["rev"] == 1 and be.cloud()["data"] == local, be.cloud())
    be.down = False
    online(pg)                                       # 連上網路：sync.js 立刻重試
    ok = wait_until(pg, lambda: be.cloud()["rev"] == 2)
    up = json.loads(be.cloud()["data"]) if ok else None
    check(f"{L} S3[D] 上傳清除後的狀態（雲端 rev 2、it 空，隱藏與設定照這台）", ok and up["it"] == {} and up["v"] == 2, be.cloud())
    check(f"{L} S3[D] 舊紀錄不復活：這台存檔與記憶體 it 都空", DIT(pg) == {} and MST(pg)["it"] == {}, (DIT(pg), MST(pg)["it"]))
    check(f"{L} S3[D] sync.js 沒有要求頁面換成雲端舊版（accept 沒被呼叫）", calls(pg)["acc"] == [], calls(pg))
    ctx.close()


def s4(br, L):
    """(iv) 已同步、離線答題（本機≠baseline）、雲端被另一台更新 → 不替換、本機保留。"""
    be = Backend()
    local = v2({A_["id"]: ent(n=2, ok=2)})
    ctx = ctx_for(br, be, local)
    pg = e2e.page_in(ctx)
    if not first_sync(pg, be, L, "S4"):
        return ctx.close()
    be.down = True
    try_answer(pg, B_)                               # 離線時答了 b：本機存好，雲端還沒有
    check(f"{L} S4[前提] 離線答題已存在這台（a、b）", sorted(DIT(pg)) == sorted([A_["id"], B_["id"]]), DIT(pg))
    other = v2({A_["id"]: ent(n=2, ok=2), C_["id"]: ent(n=5, ok=5)})
    be.other_device_put(other)                       # 同時另一台把雲端更新成 rev 2
    be.down = False
    online(pg)
    ok = wait_until(pg, lambda: "兩台的紀錄不一樣" in panel(pg))
    check(f"{L} S4[D] 不替換、本機保留：存檔與記憶體仍是 a、b，沒有另一台的 c", sorted(DIT(pg)) == sorted([A_["id"], B_["id"]]) and C_["id"] not in MST(pg)["it"], DIT(pg))
    check(f"{L} S4[D] 雲端也沒被覆寫（仍是另一台的 rev 2）", be.cloud()["rev"] == 2 and be.cloud()["data"] == other, be.cloud())
    check(f"{L} S4[D] sync.js 沒有要求頁面換成雲端版（accept 沒被呼叫）", calls(pg)["acc"] == [], calls(pg))
    check(f"{L} S4[UI] 同步面板寫出兩台不一樣、各自保留", ok, panel(pg)[:200])
    ctx.close()


def main():
    if SYNC != "live":
        got = hashlib.sha256(PIN.read_bytes()).hexdigest()
        check(f"固定版本 sync.js 未被改動（sha256 {PIN_SHA[:8]}…）", got == PIN_SHA, got)
    print(f"sync.js：{'正式網址 ' + e2e.SYNC_URL if SYNC == 'live' else PIN}；網站：{e2e.ROOT}")
    with sync_playwright() as p:
        for name, launch in [("CR", p.chromium), ("WK", p.webkit)]:
            br = launch.launch()
            for f in (s1, s2, s3, s4):
                try:
                    f(br, name)
                except Exception as e:
                    check(f"{name} {f.__name__} 執行例外", False, repr(e)[:300])
            br.close()
    bad = [r for r in e2e.RESULTS if not r[1]]
    print(f"\n{len(e2e.RESULTS) - len(bad)}/{len(e2e.RESULTS)} PASS")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
