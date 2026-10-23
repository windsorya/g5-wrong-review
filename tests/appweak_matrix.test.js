// 各科 app 待加強（#3016）競態驗收矩陣 M01–M24（Codex 設計者 2026-10-23，/tmp/cc3016_designer_out.md 第 4 節）。
// 跑的是**建好的 index.html 裡那兩段 script**（appweak.js 內嵌那段＋頁面那段），在 node:vm 裡換掉 document／localStorage／fetch／計時器；
// 科目站 export 用合成替身，存檔也是合成的（不放真實姓名學校）。M25（畫面、練習中隱藏、320/390px）由 tests/e2e_appweak.py 瀏覽器跑。
// 自然以外三科預設 0／2／0 題；T＝總數；ΔE／ΔC＝新增的 export 請求／雲端請求數。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// G5_INDEX＝拿別一版建置產物來跑（突變／前版對照用）；平常不設
const HTML = fs.readFileSync(process.env.G5_INDEX || path.join(__dirname, "..", "index.html"), "utf8");
const SCRIPTS = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const LIB = SCRIPTS.find((s) => s.includes("root.G5AppWeak = api"));
const PAGE = SCRIPTS.find((s) => s.includes("var W = window.G5AppWeak, A = window.G5WrongApp"));
assert.ok(LIB && PAGE, "index.html 找不到 appweak 兩段 script（先跑 build.py）");

const KEYS = ["g5sci.v3", "g5math.v2", "g5chi.v1", "g5soc.v1"];
const SCI = KEYS[0];
const T0 = Date.UTC(2026, 9, 19, 4, 0, 0);   // 台北 12:00
const save = (o) => JSON.stringify(Object.assign({ w: 0 }, o));
const sum = (w, x) => Object.assign({ ok: true, answers: 10, seen: 5, weak: w, weakToday: w, challenge: 0, challengeToday: 0, out: 0 }, x || {});
// 合成 export：f(存檔物件, now) 回傳 summarize 結果；預設照存檔的 w
const ex = (key, f, extra) => Object.assign({ api: 1, key, links: { weak: null, challenge: null }, summarize: (raw, now) => (f || ((o) => sum(o.w)))(JSON.parse(raw), now) }, extra || {});
// 只讀得懂某個 tag 的 export（M07、M08）
const only = (tag, w) => ex(SCI, (o) => (o.tag === tag ? sum(w) : { ok: false }));
const flush = () => new Promise((r) => setImmediate(r));

function harness(opt) {
  opt = opt || {};
  let clock = opt.now || T0;
  const timers = [];
  let tid = 0;
  const ls = new Map();
  const others = { "g5math.v2": save({ w: 2 }), "g5chi.v1": save({ w: 0 }), "g5soc.v1": save({ w: 0 }) };
  Object.entries(Object.assign({}, opt.noOthers ? {} : others, opt.local || {})).forEach(([k, v]) => v != null && ls.set(k, v));
  if (opt.code) ls.set("g5sync.code", opt.code);
  const scripts = [], fetches = [], listeners = {}, docListeners = {};
  const els = {};
  ["awRows", "awTotal", "awCh", "awChRows", "awReload"].forEach((id) => (els["#" + id] = { innerHTML: "", textContent: "", hidden: false }));
  const box = { hidden: true };
  const localStorage = {
    getItem: (k) => { if (opt.lsThrows) throw new Error("denied"); return ls.has(k) ? ls.get(k) : null; },
    setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k), clear: () => ls.clear(),
  };
  const document = {
    visibilityState: "visible",
    getElementById: (id) => (id === "appWeak" ? box : null),
    querySelector: (s) => els[s],
    createElement: () => ({}),
    head: { appendChild: (el) => scripts.push({ el, key: KEYS.find((k) => el.src.includes(subjSite(k))), src: el.src }) },
    addEventListener: (t, f) => (docListeners[t] = (docListeners[t] || []).concat(f)),
  };
  function FakeDate(...a) { return a.length ? new Date(...a) : new Date(clock); }
  FakeDate.now = () => clock; FakeDate.UTC = Date.UTC;
  const window = {
    localStorage, document,
    addEventListener: (t, f) => (listeners[t] = (listeners[t] || []).concat(f)),
    AbortController: class { constructor() { this.signal = { aborted: false }; } abort() { this.signal.aborted = true; } },
    G5WrongApp: { practicing: () => false, subscribe() {} },
    G5WrongCore: { own: 1 },
  };
  window.window = window;
  const ctx = vm.createContext(Object.assign(window, {
    Date: FakeDate, Math, JSON, String, Number, Object, Array, URL, Error,
    setTimeout: (f, ms) => { timers.push({ id: ++tid, at: clock + ms, f }); return tid; },
    clearTimeout: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    setInterval: (f, ms) => { const t = { id: ++tid, at: clock + ms, f, every: ms }; timers.push(t); return tid; },
    fetch: (url, cfg) => new Promise((res, rej) => fetches.push({ body: JSON.parse(cfg.body), signal: cfg.signal, res: (o) => res({ json: () => Promise.resolve(o) }), rej })),
  }));
  vm.runInContext(LIB, ctx);
  vm.runInContext(PAGE, ctx);
  const h = {
    ls, scripts, fetches, window,
    // 第 i 個 export 請求載完：reg＝要註冊的物件（undefined＝沒註冊）；run＝檔案自己執行的其他動作
    load(i, reg, run) {
      const s = scripts[i];
      if (run) run(window);
      if (reg !== undefined) { window.G5WeakExport = window.G5WeakExport || {}; window.G5WeakExport[s.key] = reg; }
      s.el.onload();
    },
    fail(i) { scripts[i].el.onerror(); },
    async tick(ms) {
      const end = clock + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at || a.id - b.id);
        const t = timers[0];
        if (!t || t.at > end) break;
        clock = t.at;
        if (t.every) t.at += t.every; else timers.shift();
        t.f();
        await flush();
      }
      clock = end;
      await flush();
    },
    async cloud(i, o) { fetches[i].res(o); await flush(); await flush(); },
    async cloudFail(i) { fetches[i].rej(new Error("net")); await flush(); await flush(); },
    click() { els["#awReload"].onclick(); },
    storage(key) { (listeners.storage || []).forEach((f) => f({ key })); },
    visible() { (docListeners.visibilitychange || []).forEach((f) => f()); },
    state(key) { const m = new RegExp('data-key="' + key + '" data-state="([a-z]+)"><div class="awm"><b>[^<]*</b><span class="aws [a-z]+">([^<]*)</span>').exec(els["#awRows"].innerHTML); return m ? { state: m[1], text: m[2] } : null; },
    sci() { return h.state(SCI); },
    total() { const m = /共 (\d+) 題/.exec(els["#awTotal"].textContent); return m ? Number(m[1]) : els["#awTotal"].textContent; },
    totalText() { return els["#awTotal"].textContent; },
    href(key) { const m = new RegExp('data-key="' + key + '"[\\s\\S]*?href="([^"]*)"').exec(els["#awRows"].innerHTML); return m && m[1]; },
    // 載完自然以外三科（預設 export 照存檔 w）
    others() { scripts.forEach((s, i) => { if (s.key !== SCI && !s.done) { s.done = true; h.load(i, ex(s.key)); } }); },
    sciIdx(n) { return scripts.map((s, i) => (s.key === SCI ? i : -1)).filter((i) => i >= 0)[n]; },
    get E() { return scripts.length; }, get C() { return fetches.length; },
  };
  return h;
}
function subjSite(k) { return { "g5sci.v3": "g5-sci-review", "g5math.v2": "g5-math-review", "g5chi.v1": "g5-chinese-review", "g5soc.v1": "g5-social-review" }[k]; }
// 自然：A1 逾時→重新讀取→A2 載入中（回傳 [A1, A2] 的 scripts 索引）
async function timeoutThenRetry(h) {
  await h.tick(15000);
  h.click();
  return [h.sciIdx(0), h.sciIdx(1)];
}
const BAD_EXPORTS = {
  api錯: () => ex(SCI, null, { api: 2 }), key錯: () => ex("g5math.v2"), 缺函式: () => ({ api: 1, key: SCI }),
  題數缺欄: () => ex(SCI, () => { const s = sum(3); delete s.out; return s; }),
  負數: () => ex(SCI, () => sum(-1)), 小數: () => ex(SCI, () => sum(1.5)), 字串: () => ex(SCI, () => sum("3")),
  "weakToday>weak": () => ex(SCI, () => sum(3, { weakToday: 4 })), "challengeToday>challenge": () => ex(SCI, () => sum(3, { challenge: 1, challengeToday: 2 })),
};
const UNREADABLE = { "ok:false": () => ex(SCI, () => ({ ok: false })), 拋例外: () => ex(SCI, () => { throw new Error("x"); }) };

test("M01 並行與逾時：自然卡住不拖住別科；15 秒標量不到；重新讀取成功 3 題", async () => {
  const h = harness({ local: { [SCI]: save({ w: 3 }) } });
  assert.equal(h.E, 4, "四科同時發出");
  h.others();
  assert.equal(h.sci().state, "loading"); assert.equal(h.total(), 2);
  await h.tick(15000);
  assert.equal(h.sci().state, "na"); assert.match(h.sci().text, /還沒提供|連不上/); assert.equal(h.total(), 2);
  h.click();
  assert.equal(h.E, 5);
  assert.match(h.scripts[4].src, /\?r=/, "重試換網址");
  h.load(4, ex(SCI));
  assert.equal(h.sci().text, "待加強 3 題"); assert.equal(h.total(), 5);
  assert.equal(h.E, 5); assert.equal(h.C, 0);
});

test("M02 錯誤分類及恢復：九種格式不對→格式不對、重新讀取恢復；ok:false／拋例外＝讀不懂", async () => {
  for (const [name, mk] of Object.entries(BAD_EXPORTS)) {
    const h = harness({ local: { [SCI]: save({ w: 3 }) } });
    h.others(); h.load(0, mk());
    assert.match(h.sci().text, /格式不對/, name); assert.equal(h.total(), 2, name);
    h.click(); assert.equal(h.E, 5, name);
    h.load(4, ex(SCI));
    assert.equal(h.sci().text, "待加強 3 題", name); assert.equal(h.total(), 5, name); assert.equal(h.C, 0);
  }
  for (const [name, mk] of Object.entries(UNREADABLE)) {
    const h = harness({ local: { [SCI]: save({ w: 3 }) } });
    h.others(); h.load(0, mk());
    assert.match(h.sci().text, /讀不懂/, name);
  }
});

test("M03 後續失敗不得撤結果：A1 晚到 3 題後，A2 任何失敗都保留 3 題", async () => {
  const fails = {
    網路錯: (h, i) => h.fail(i), 逾時: (h) => h.tick(15000), api錯: (h, i) => h.load(i, BAD_EXPORTS.api錯()),
    題數格式錯: (h, i) => h.load(i, BAD_EXPORTS.負數()), "ok:false": (h, i) => h.load(i, UNREADABLE["ok:false"]()), 拋例外: (h, i) => h.load(i, UNREADABLE.拋例外()),
  };
  for (const [name, f] of Object.entries(fails)) {
    const h = harness({ local: { [SCI]: save({ w: 3 }) } });
    h.others();
    const [a1, a2] = await timeoutThenRetry(h);
    h.load(a1, ex(SCI));
    assert.equal(h.sci().text, "待加強 3 題", name);
    const e = h.E;
    await f(h, a2);
    assert.equal(h.sci().text, "待加強 3 題", name); assert.equal(h.total(), 5, name);
    h.click();   // 已有 3 題：不重載
    assert.equal(h.E, e, name); assert.equal(h.C, 0);
  }
});

test("M04 壞重試先回：A2 格式不對先到→顯示格式不對；A1 晚到 3 題→3 題", async () => {
  for (const name of ["api錯", "負數"]) {
    const h = harness({ local: { [SCI]: save({ w: 3 }) } });
    h.others();
    const [a1, a2] = await timeoutThenRetry(h);
    h.load(a2, BAD_EXPORTS[name]());
    assert.match(h.sci().text, /格式不對/, name); assert.equal(h.total(), 2);
    h.load(a1, ex(SCI));
    assert.equal(h.sci().text, "待加強 3 題", name); assert.equal(h.total(), 5);
  }
});

test("M05 部分來源失敗：本機 3 題、雲端那份對 A1 格式錯、A2 網路錯或逾時→仍顯示本機 3 題", async () => {
  for (const how of ["網路錯", "逾時"]) {
    const h = harness({ local: { [SCI]: save({ w: 3 }) }, code: "F" });
    h.others();
    assert.equal(h.C, 4);
    for (let i = 1; i < 4; i++) await h.cloud(i, { ok: true, rev: 0, data: null, updated: null });
    await h.tick(15000);   // A1 與自然雲端都逾時
    h.click();
    const a1 = h.sciIdx(0), a2 = h.sciIdx(1);
    const sciFetch = h.fetches.findLastIndex((f) => f.body.key === SCI);
    const A1 = ex(SCI, (o) => (o.tag === "C" ? sum(3, { weakToday: 9 }) : sum(o.w)));
    h.load(a1, A1);
    assert.equal(h.sci().text, "待加強 3 題");
    await h.cloud(sciFetch, { ok: true, rev: 2, data: save({ w: 8, tag: "C" }), updated: T0 });
    assert.equal(h.sci().text, "待加強 3 題", how); assert.equal(h.total(), 5);
    const e = h.E, c = h.C;
    if (how === "網路錯") h.fail(a2); else await h.tick(15000);
    assert.equal(h.sci().text, "待加強 3 題", how); assert.equal(h.total(), 5, how);
    assert.equal(h.E, e); assert.equal(h.C, c);
  }
});

test("M06 部分有效時手動重讀：不重載、不清空 export，只重抓雲端 4 科", async () => {
  for (const how of ["再次錯誤紀錄", "請求失敗"]) {
    const h = harness({ local: { [SCI]: save({ w: 3 }) }, code: "F" });
    h.load(0, ex(SCI, (o) => (o.tag === "C" ? sum(3, { weakToday: 9 }) : sum(o.w)))); h.others();
    for (let i = 0; i < 4; i++) await h.cloud(i, i === 0 ? { ok: true, rev: 2, data: save({ w: 8, tag: "C" }), updated: T0 } : { ok: true, rev: 0, data: null, updated: null });
    assert.equal(h.sci().text, "待加強 3 題"); assert.equal(h.total(), 5);
    const e = h.E, c = h.C;
    h.click();
    assert.equal(h.E - e, 0, "不得重載 export"); assert.equal(h.C - c, 4);
    assert.equal(h.sci().text, "待加強 3 題", "重抓中也不清空");
    const i = h.fetches.findLastIndex((f) => f.body.key === SCI);
    if (how === "請求失敗") await h.cloudFail(i); else await h.cloud(i, { ok: true, rev: 3, data: save({ w: 8, tag: "C" }), updated: T0 });
    assert.equal(h.sci().text, "待加強 3 題", how); assert.equal(h.total(), 5);
  }
});

test("M07 紀錄更新才失效：A1 對 L 算 3 題→本機變 M 回格式錯→重讀 A2 對 M 算 7 題", async () => {
  const h = harness({ local: { [SCI]: save({ w: 3, tag: "L" }) } });
  h.others();
  h.load(0, ex(SCI, (o) => (o.tag === "L" ? sum(3) : sum(-1))));
  assert.equal(h.sci().text, "待加強 3 題");
  h.ls.set(SCI, save({ w: 7, tag: "M" })); h.storage(SCI);
  assert.match(h.sci().text, /格式不對/); assert.equal(h.total(), 2);
  h.click(); assert.equal(h.E, 5);
  h.load(4, only("M", 7));
  assert.equal(h.sci().text, "待加強 7 題"); assert.equal(h.total(), 9);
});

const PERMS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
test("M08 不能只留兩份：A1 懂 L、A2 懂 M、A3 懂 N，六種到達順序，紀錄 L→M→N→L 顯示 3→7→9→3", async () => {
  for (const order of PERMS) {
    const h = harness({ local: { [SCI]: save({ tag: "L" }) } });
    h.others();
    await h.tick(15000); h.click(); await h.tick(15000); h.click(); await h.tick(15000);
    const idx = [0, 1, 2].map((n) => h.sciIdx(n));
    assert.equal(h.E, 6, "三次自然 export");
    const exps = [only("L", 3), only("M", 7), only("N", 9)];
    order.forEach((n) => h.load(idx[n], exps[n]));
    const seen = [];
    for (const tag of ["L", "M", "N", "L"]) { h.ls.set(SCI, save({ tag })); h.storage(SCI); seen.push(h.sci().text + "/" + h.total()); }
    assert.deepEqual(seen, ["待加強 3 題/5", "待加強 7 題/9", "待加強 9 題/11", "待加強 3 題/5"], String(order));
    assert.equal(h.E, 6); assert.equal(h.C, 0);
  }
});

test("M09 嘗試序按發出、合法零題也是量得：A2 算 {5,0}，A1 晚到 3 題，兩種完成順序都顯示 A2", async () => {
  for (const w of [5, 0]) for (const a1First of [false, true]) {
    const h = harness({ local: { [SCI]: save({}) } });
    h.others();
    const [a1, a2] = await timeoutThenRetry(h);
    const go = [() => h.load(a2, ex(SCI, () => sum(w))), () => h.load(a1, ex(SCI, () => sum(3)))];
    (a1First ? go.reverse() : go).forEach((f) => f());
    assert.equal(h.sci().text, w ? "待加強 5 題" : "沒有待加強的題", `${w}/${a1First}`);
    assert.equal(h.total(), w + 2);
  }
});

test("M10 載入中的不能被舊回呼解除：A2 載入中時重讀不發新請求；A2 逾時後才重載", async () => {
  const h = harness({ local: { [SCI]: save({ w: 3 }) } });
  h.others();
  const [a1] = await timeoutThenRetry(h);
  const e0 = h.E;
  h.load(a1, BAD_EXPORTS.api錯());
  assert.equal(h.sci().state, "loading", "A2 還在載：讀取中優先於格式不對");
  h.click(); h.click();
  assert.equal(h.E, e0, "A2 載入中，不得新增請求");
  await h.tick(15000);
  assert.match(h.sci().text, /格式不對/);
  h.click();
  assert.equal(h.E, e0 + 1);
  h.load(h.sciIdx(2), ex(SCI));
  assert.equal(h.sci().text, "待加強 3 題"); assert.equal(h.total(), 5);
  assert.equal(h.C, 0);
});

test("M11 非成功優先序（W.pick 純函式）：讀不懂＞格式不對＞載不到；有載入中改讀取中；有可算的改 ok；同級取最大嘗試序", () => {
  const ctx = vm.createContext({ Math, JSON, String, Number, Object, Array, URL, Error, Date });
  vm.runInContext(LIB, ctx);
  const W = ctx.G5AppWeak, S0 = W.SUBJECTS[0];
  const base = { local: { raw: save({ w: 3 }) }, cloud: "nocode", auto: false };
  const snap = (e) => W.snapshot(e, S0);
  let A = [{ id: 1, st: "cand", exp: snap(UNREADABLE["ok:false"]()) }, { id: 2, st: "bad" }, { id: 3, st: "error" }, { id: 4, st: "cand", exp: snap(BAD_EXPORTS.負數()) }];
  let r = W.pick(S0, A, base, T0);
  assert.match(r.why, /讀不懂/); assert.equal(r.attempt, 1);
  A = A.concat({ id: 5, st: "pending" });
  assert.equal(W.pick(S0, A, base, T0).state, "loading");
  A = A.concat({ id: 6, st: "cand", exp: snap(ex(SCI)) });
  r = W.pick(S0, A, base, T0); assert.equal(r.state, "ok"); assert.equal(r.sum.weak, 3); assert.equal(r.attempt, 6);
  // 同級取最大嘗試序（不看陣列順序）
  r = W.pick(S0, [{ id: 9, st: "cand", exp: snap(ex(SCI, () => sum(4))) }, { id: 7, st: "cand", exp: snap(ex(SCI, () => sum(1))) }], base, T0);
  assert.equal(r.attempt, 9); assert.equal(r.sum.weak, 4);
  r = W.pick(S0, [{ id: 3, st: "bad" }, { id: 8, st: "bad" }, { id: 5, st: "timeout" }], base, T0);
  assert.equal(r.attempt, 8); assert.match(r.why, /格式不對/);
  assert.equal(W.wantReload(W.pick(S0, [{ id: 1, st: "error" }], base, T0), [{ id: 1, st: "error" }]), true);
  assert.equal(W.wantReload(W.pick(S0, [{ id: 1, st: "pending" }], base, T0), [{ id: 1, st: "pending" }]), false);
});

test("M12 四科交錯：四科逾時→重讀→舊請求晚到 1／2／3／4 題、新請求失敗或格式錯（正反兩種交錯），四科都保留數字", async () => {
  for (const reverse of [false, true]) {
    const h = harness({ local: { [SCI]: save({}) } });
    await h.tick(15000);
    h.click();
    assert.equal(h.E, 8);
    const steps = [];
    KEYS.forEach((k, n) => {
      steps.push(() => h.load(n, ex(k, () => sum(n + 1))));
      steps.push(() => (n % 2 ? h.fail(4 + n) : h.load(4 + n, ex(k, () => sum(-1)))));
    });
    (reverse ? steps.reverse() : steps).forEach((f) => f());
    KEYS.forEach((k, n) => assert.equal(h.state(k).text, `待加強 ${n + 1} 題`, `${k}/${reverse}`));
    assert.equal(h.total(), 10); assert.equal(h.C, 0);
  }
});

const REV0 = { ok: true, rev: 0, data: null, updated: null };
const cloudOf = (w) => ({ ok: true, rev: 3, data: save({ w }), updated: T0 });
async function answerOthers(h, from) { for (let i = from; i < h.C; i++) if (h.fetches[i].body.key !== SCI) await h.cloud(i, REV0); }
test("M13 換家庭碼：F 請求未完成→換 G（storage 通知／輪詢兩種）→G 回 5 題→F 晚回 36 題或錯誤，仍是 G 的 5 題", async () => {
  for (const via of ["storage", "poll"]) for (const late of ["36題", "錯誤"]) {
    const h = harness({ code: "F", local: { [SCI]: null } });
    h.load(0, ex(SCI)); h.others();
    const f = h.fetches.findIndex((x) => x.body.key === SCI);
    await answerOthers(h, 0);
    h.ls.set("g5sync.code", "G");
    if (via === "poll") {
      // 輪詢前 F 先回：不得顯示
      await (late === "36題" ? h.cloud(f, cloudOf(36)) : h.cloudFail(f));
      assert.notEqual(h.sci().text, "待加強 36 題", "輪詢前的 F 回應");
      const c = h.C;
      await h.tick(5000);
      assert.equal(h.C - c, 4);
    } else {
      const c = h.C; h.storage("g5sync.code"); assert.equal(h.C - c, 4);
    }
    const g = h.fetches.findLastIndex((x) => x.body.key === SCI);
    assert.equal(h.fetches[g].body.code, "G");
    await answerOthers(h, g - 3 > 0 ? g - 3 : 0);
    await h.cloud(g, cloudOf(5));
    if (via === "storage") await (late === "36題" ? h.cloud(f, cloudOf(36)) : h.cloudFail(f));
    assert.equal(h.sci().text, "待加強 5 題", `${via}/${late}`); assert.equal(h.total(), 7);
  }
});

test("M13b 同頁換碼、輪詢還沒發現就 render：已載好的舊家庭雲端那份不得顯示", async () => {
  const h = harness({ code: "F", local: { [SCI]: null } });
  h.load(0, ex(SCI)); h.others();
  for (let i = 0; i < 4; i++) await h.cloud(i, h.fetches[i].body.key === SCI ? cloudOf(36) : REV0);
  assert.equal(h.sci().text, "待加強 36 題");
  h.ls.set("g5sync.code", "G");
  h.storage("g5math.v2");   // 別的原因觸發 render（科目紀錄更新），輪詢 5 秒還沒到
  assert.notEqual(h.sci().text, "待加強 36 題");
  assert.equal(h.sci().state, "loading");
  await h.tick(5000);
  const g = h.fetches.findLastIndex((x) => x.body.key === SCI);
  assert.equal(h.fetches[g].body.code, "G");
  await h.cloud(g, cloudOf(5));
  assert.equal(h.sci().text, "待加強 5 題");
});

test("M14 家庭碼繞回 F→G→F：最新 F 回 5 題、最早 F 晚回 36 題，仍 5 題；雲端請求 8", async () => {
  const h = harness({ code: "F", local: { [SCI]: null } });
  h.load(0, ex(SCI)); h.others();
  const f1 = h.fetches.findIndex((x) => x.body.key === SCI);
  await answerOthers(h, 0);
  const c0 = h.C;
  h.ls.set("g5sync.code", "G"); h.storage("g5sync.code");
  h.ls.set("g5sync.code", "F"); h.storage("g5sync.code");
  assert.equal(h.C - c0, 8);
  const f2 = h.fetches.findLastIndex((x) => x.body.key === SCI);
  await answerOthers(h, c0);
  await h.cloud(f2, cloudOf(5));
  await h.cloud(f1, cloudOf(36));
  assert.equal(h.sci().text, "待加強 5 題"); assert.equal(h.total(), 7);
});

test("M15 移除家庭：F 請求未完成→移除家庭碼／storage.clear→F 晚回，不顯示", async () => {
  for (const how of ["移除碼", "clear"]) {
    const h = harness({ code: "F", local: { [SCI]: null } });
    h.load(0, ex(SCI)); h.others();
    const f = h.fetches.findIndex((x) => x.body.key === SCI);
    await answerOthers(h, 0);
    const c = h.C;
    if (how === "移除碼") { h.ls.delete("g5sync.code"); h.storage("g5sync.code"); } else { h.ls.clear(); h.storage(null); }
    await h.cloud(f, cloudOf(36));
    assert.equal(h.C, c, how);
    if (how === "移除碼") { assert.match(h.sci().text, /還沒開跨裝置同步/); assert.equal(h.total(), 2); }
    else { KEYS.forEach((k) => assert.equal(h.state(k).state, "na")); assert.equal(h.totalText(), "各科題數都還量不到"); }
  }
});

test("M16 同頁開同步：沒有 storage 事件，5 秒輪詢發現家庭碼→雲端 3 題", async () => {
  const h = harness({ local: { [SCI]: null } });
  h.load(0, ex(SCI)); h.others();
  assert.match(h.sci().text, /還沒開跨裝置同步/);
  h.ls.set("g5sync.code", "F");
  await h.tick(5000);
  assert.equal(h.C, 4);
  await answerOthers(h, 0);
  await h.cloud(h.fetches.findIndex((x) => x.body.key === SCI), cloudOf(3));
  assert.equal(h.sci().text, "待加強 3 題"); assert.equal(h.total(), 5);
});

test("M17 節流與去重：30 秒內 visible 0、滿 30 秒 visible 4、手動 4、同碼請求中再按 0", async () => {
  const h = harness({ code: "F", local: { [SCI]: null } });
  h.load(0, ex(SCI)); h.others();
  for (let i = 0; i < 4; i++) await h.cloud(i, h.fetches[i].body.key === SCI ? cloudOf(3) : REV0);
  assert.equal(h.total(), 5);
  let c = h.C; h.visible(); assert.equal(h.C - c, 0, "30 秒內");
  await h.tick(30000); c = h.C; h.visible(); assert.equal(h.C - c, 4, "滿 30 秒");
  for (let i = c; i < h.C; i++) await h.cloud(i, h.fetches[i].body.key === SCI ? cloudOf(3) : REV0);
  c = h.C; h.click(); assert.equal(h.C - c, 4, "手動");
  c = h.C; h.click(); assert.equal(h.C - c, 0, "請求中再按");
  assert.equal(h.sci().text, "待加強 3 題"); assert.equal(h.total(), 5); assert.equal(h.E, 4);
});

test("M18 量不到不冒充零：七種量不到原因各自正確、總數不顯示 0", async () => {
  const cases = [
    ["無紀錄無碼", {}, null, /還沒開跨裝置同步/],
    ["rev0", { code: "F" }, REV0, /這台和雲端都還沒有/],
    ["rev0且auto", { code: "F", auto: true }, REV0, /跨裝置同步」貼家裡的連結/],
    ["雲端失敗", { code: "F" }, "fail", /雲端暫時讀不到/],
    ["雲端回應不合格", { code: "F" }, { ok: true, rev: 1, data: 5, updated: T0 }, /雲端暫時讀不到/],
    ["紀錄讀不懂", { raw: "{}" }, null, /讀不懂/],
  ];
  for (const [name, o, resp, re] of cases) {
    const h = harness({ noOthers: true, code: o.code, local: { [SCI]: o.raw || null } });
    if (o.auto) h.ls.set("g5sync.auto", "1");
    h.load(0, ex(SCI, (x) => (x.w === undefined ? { ok: false } : sum(x.w)))); h.others();
    for (let i = 0; i < h.C; i++) await (resp === "fail" ? h.cloudFail(i) : h.cloud(i, resp));
    assert.match(h.sci().text, re, name); assert.equal(h.sci().state, "na", name);
    assert.equal(h.totalText(), "各科題數都還量不到", name);
  }
  const h = harness({ lsThrows: true, noOthers: true });
  h.load(0, ex(SCI)); h.others();
  assert.match(h.sci().text, /紀錄讀不到/); assert.equal(h.totalText(), "各科題數都還量不到");
});

test("M21 全域保護：自然的檔換掉錯題站全域→換回原物件、自然格式不對、其他三科正常", async () => {
  const h = harness({ local: { [SCI]: save({ w: 3 }) } });
  const own = h.window.G5WrongCore;
  h.others();
  h.load(0, ex(SCI), (w) => { w.G5WrongCore = { evil: 1 }; });
  assert.equal(h.window.G5WrongCore, own);
  assert.match(h.sci().text, /格式不對/); assert.equal(h.total(), 2);
});

test("M22 殘留註冊槽：A2 沒註冊／只註冊別科，不得把 A1 留下的物件算成自己的", async () => {
  for (const how of ["未註冊", "只註冊別科"]) {
    const h = harness({ local: { [SCI]: save({ w: 3 }) } });
    h.others();
    const [a1, a2] = await timeoutThenRetry(h);
    h.load(a1, ex(SCI, (o) => (o.w === undefined ? { ok: false } : sum(o.w))));
    assert.equal(h.window.G5WeakExport[SCI], undefined, "讀完清掉註冊槽");
    h.load(a2, undefined, how === "只註冊別科" ? (w) => { w.G5WeakExport["g5math.v2"] = ex("g5math.v2", () => sum(40)); } : null);
    assert.equal(h.sci().text, "待加強 3 題", how); assert.equal(h.total(), 5, how);
    // A1 讀不懂的紀錄：讀不懂（A1，介面合格）優先於格式不對（A2 沒註冊）；勝出的仍是 A1
    h.ls.set(SCI, "{}"); h.storage(SCI);
    assert.match(h.sci().text, /讀不懂/);
  }
});

test("M23 候選隔離：存好後改原物件的 summarize／links 不影響；摘要欄位 getter 拋例外不弄壞頁面", async () => {
  const h = harness({ local: { [SCI]: save({ w: 3 }) } });
  h.others();
  const e = ex(SCI, null, { links: { weak: "https://windsorya.github.io/g5-sci-review/?weak=1", challenge: null } });
  h.load(0, e);
  assert.equal(h.sci().text, "待加強 3 題");
  e.summarize = () => sum(99); e.links.weak = "https://evil.example/";
  h.storage(SCI);
  assert.equal(h.sci().text, "待加強 3 題");
  assert.equal(h.href(SCI), "https://windsorya.github.io/g5-sci-review/?weak=1");
  // getter 拋例外的候選
  const h2 = harness({ local: { [SCI]: save({ w: 3 }) } });
  h2.others();
  const boom = ex(SCI, () => { const s = sum(3); Object.defineProperty(s, "weak", { get() { throw new Error("boom"); } }); return s; });
  assert.doesNotThrow(() => h2.load(0, boom));
  assert.match(h2.sci().text, /格式不對/); assert.equal(h2.total(), 2);
  assert.equal(h2.state("g5math.v2").text, "待加強 2 題");
});

test("M24 時間也是輸入：同一紀錄台北跨日後 weakToday 重算；同一次選擇所有候選拿到同一個 now", async () => {
  const nows = [];
  const dayOf = (ms) => new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
  const mkE = () => ex(SCI, (o, now) => { nows.push(now); return sum(3, { weakToday: dayOf(now) === o.day ? 2 : 3 }); });
  const start = Date.UTC(2026, 9, 19, 15, 59, 0);   // 台北 23:59
  const h = harness({ now: start, local: { [SCI]: save({ w: 3, day: dayOf(start) }) } });
  h.others();
  await h.tick(15000); h.click();
  h.load(h.sciIdx(0), mkE()); h.load(h.sciIdx(1), mkE());
  assert.match(h.sci().text, /今天可以練 2 題/);
  await h.tick(60000);
  nows.length = 0;
  h.visible();
  assert.equal(h.sci().text, "待加強 3 題"); assert.equal(h.total(), 5);
  assert.ok(nows.length >= 2 && nows.every((n) => n === nows[0]), "同一次 render 的 now 一致：" + nows.join(","));
});
