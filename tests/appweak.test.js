// 各科 app 待加強（#3016，docs/app-weak-entry-design-20261019.md 第 6 節單元測試）。
// 科目站的 weak-export.js 用合成替身（mk）；存檔字串也是合成的，不放真實姓名學校。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
// G5_APPWEAK＝突變檢查（~/scripts/mutation_check.py --sandbox）指向副本用；平常不設
const W = require(process.env.G5_APPWEAK || "../src/appweak.js");

const SCI = W.SUBJECTS[0];
const NOW = Date.UTC(2026, 9, 19, 12, 0, 0);
// 合成存檔：{a: answers, s: seen, w: weak, wt: weakToday, c: challenge, ct: challengeToday, o: out}
// 今天可練沒指定時＝全部（不然 wt>w 會被當成格式不對，選份測試就變成假通過）
const save = (o) => { const x = Object.assign({ a: 10, s: 5, w: 3, c: 1, o: 2 }, o); if (x.wt === undefined) x.wt = x.w; if (x.ct === undefined) x.ct = x.c; return JSON.stringify(x); };
function mk(over) {
  return Object.assign({
    api: 1, key: "g5sci.v3", links: { weak: null, challenge: null },
    summarize(raw) {
      const x = JSON.parse(raw);
      if (x.bad) return { ok: false };
      return { ok: true, answers: x.a, seen: x.s, weak: x.w, weakToday: x.wt, challenge: x.c, challengeToday: x.ct, out: x.o };
    }
  }, over || {});
}
const R = (src) => W.resolve(SCI, src, NOW);
const NA_STATES = [
  { exp: undefined, local: { raw: save() } },
  { exp: null, local: { raw: save() } },
  { exp: "bad", local: { raw: save() } },
  { exp: { api: 2, key: "g5sci.v3", summarize() {} }, local: { raw: save() } },
  { exp: mk(), local: { raw: null }, cloud: "nocode" },
  { exp: mk(), local: { raw: null }, cloud: "fail" },
  { exp: mk(), local: { raw: null }, cloud: { rev: 0, data: null, updated: null } },
  { exp: mk(), local: { raw: save({ bad: 1 }) }, cloud: "nocode" },
  { exp: mk(), local: { err: true }, cloud: "fail" },
  { exp: mk(), local: { raw: null }, cloud: "pending" },
];

test("介面驗證：api／key／summarize 缺一不可", () => {
  assert.ok(W.okExport(mk(), "g5sci.v3"));
  assert.ok(!W.okExport(mk(), "g5math.v2"), "key 不符");
  assert.ok(!W.okExport(mk({ api: 2 }), "g5sci.v3"));
  assert.ok(!W.okExport(mk({ api: "1" }), "g5sci.v3"));
  assert.ok(!W.okExport(mk({ summarize: 1 }), "g5sci.v3"));
  [null, "x", [], 1].forEach((x) => assert.ok(!W.okExport(x, "g5sci.v3")));
});

test("回傳驗證：負數、小數、字串、缺欄、今天可練比全部多，一律不合格", () => {
  const good = { ok: true, answers: 1, seen: 1, weak: 2, weakToday: 1, challenge: 1, challengeToday: 0, out: 0 };
  assert.ok(W.okSummary(good));
  W.FIELDS.forEach((f) => {
    [-1, 1.5, "1", null, undefined, NaN, Infinity, true].forEach((v) => assert.ok(!W.okSummary(Object.assign({}, good, { [f]: v })), f + "=" + String(v)));
  });
  assert.ok(!W.okSummary(Object.assign({}, good, { ok: 1 })));
  assert.ok(!W.okSummary(Object.assign({}, good, { weakToday: 3 })), "weakToday > weak");
  assert.ok(!W.okSummary(Object.assign({}, good, { challengeToday: 2 })), "challengeToday > challenge");
  assert.ok(!W.okSummary({ ok: false }));
});

test("有數字：照科目站函式的結果，從本機讀", () => {
  const r = R({ exp: mk(), local: { raw: save({ w: 21, wt: 18, c: 4, ct: 4, o: 1 }) }, cloud: "nocode" });
  assert.equal(r.state, "ok");
  assert.equal(r.from, "local");
  assert.deepEqual(r.sum, { answers: 10, seen: 5, weak: 21, weakToday: 18, challenge: 4, challengeToday: 4, out: 1 });
  assert.equal(W.rowText(r), "待加強 21 題（今天可以練 18 題，其餘今天練過了）");
  assert.equal(W.sourceText(r), "依這台裝置的紀錄");
});

test("狀態句：0 題只在讀到紀錄、函式算出 0 時出現", () => {
  assert.equal(W.rowText(R({ exp: mk(), local: { raw: save({ w: 0, wt: 0 }) } })), "沒有待加強的題");
  assert.equal(W.rowText(R({ exp: mk(), local: { raw: save({ w: 5, wt: 5 }) } })), "待加強 5 題");
  assert.equal(W.rowText(R({ exp: mk(), local: { raw: save({ w: 5, wt: 0 }) } })), "待加強 5 題（今天都練過了，明天再練）");
});

test("量不到的每一種狀態都沒有數字、不是 0，句子都寫原因", () => {
  NA_STATES.forEach((src, i) => {
    const r = R(src);
    assert.notEqual(r.state, "ok", "第 " + i + " 種");
    assert.equal(r.sum, null);
    const t = W.rowText(r);
    assert.ok(!/\d/.test(t), "第 " + i + " 種句子有數字：" + t);
    assert.ok(r.state === "loading" ? t === "讀取中…" : t.indexOf("量不到：") === 0, t);
    assert.equal(W.sourceText(r), "");
  });
});

test("量不到的原因：沒提供、格式不對、讀不懂、沒同步、雲端讀不到、雲端也沒有", () => {
  assert.match(R({ exp: null }).why, /自然站還沒提供待加強題數/);
  assert.match(R({ exp: "bad" }).why, /格式不對/);
  assert.match(R({ exp: mk({ key: "g5soc.v1" }) }).why, /格式不對/);
  assert.match(R({ exp: mk(), local: { raw: save({ bad: 1 }) }, cloud: "nocode" }).why, /紀錄讀不懂/);
  assert.match(R({ exp: mk(), local: { raw: null }, cloud: "nocode" }).why, /這台裝置沒有自然站的紀錄，也還沒開跨裝置同步/);
  assert.match(R({ exp: mk(), local: { raw: null }, cloud: "fail" }).why, /雲端暫時讀不到/);
  const none = R({ exp: mk(), local: { raw: null }, cloud: { rev: 0, data: null, updated: null } });
  assert.match(none.why, /這台和雲端都還沒有自然站的紀錄$/);
  const auto = R({ exp: mk(), local: { raw: null }, cloud: { rev: 0, data: null, updated: null }, auto: true });
  assert.match(auto.why, /還沒跟家裡其他裝置連上/);
  assert.match(R({ exp: mk(), local: { err: true }, cloud: "nocode" }).why, /這台裝置的紀錄讀不到/);
});

test("summarize 丟例外＝那一份讀不懂；另一份讀得懂就用另一份", () => {
  const exp = mk({ summarize(raw) { if (raw === "boom") throw new Error("x"); return mk().summarize(raw); } });
  assert.match(R({ exp, local: { raw: "boom" }, cloud: "nocode" }).why, /讀不懂/);
  const r = R({ exp, local: { raw: "boom" }, cloud: { rev: 3, data: save({ w: 7, wt: 7 }), updated: NOW } });
  assert.equal(r.state, "ok"); assert.equal(r.from, "cloud"); assert.equal(r.sum.weak, 7);
  const r2 = R({ exp, local: { raw: save({ w: 2, wt: 2 }) }, cloud: { rev: 3, data: "boom", updated: NOW } });
  assert.equal(r2.from, "local"); assert.equal(r2.sum.weak, 2);
});

test("本機讀不懂、雲端還在讀 ⇒ 讀取中（等雲端，不先說讀不懂）", () => {
  const r = R({ exp: mk(), local: { raw: save({ bad: 1 }) }, cloud: "pending" });
  assert.equal(r.state, "loading");
});

test("本機 vs 雲端：比作答筆數 → 練過題數 → 平手用本機；兩份相同只算本機", () => {
  const cloud = (o) => { const d = save(o); const t = W.summarize(mk(), d, NOW); assert.ok(t && typeof t === "object", "測資本身要讀得懂（\"format\" 也是真值，不能只驗 truthy）"); return { rev: 5, data: d, updated: Date.UTC(2026, 9, 19, 13, 30) }; };
  let r = R({ exp: mk(), local: { raw: save({ a: 10, w: 1 }) }, cloud: cloud({ a: 11, w: 9 }) });
  assert.equal(r.from, "cloud"); assert.equal(r.sum.weak, 9);
  assert.equal(W.sourceText(r), "依雲端紀錄（10/19 21:30 上傳）");
  r = R({ exp: mk(), local: { raw: save({ a: 12, w: 1 }) }, cloud: cloud({ a: 11, w: 9 }) });
  assert.equal(r.from, "local"); assert.equal(r.sum.weak, 1);
  r = R({ exp: mk(), local: { raw: save({ a: 10, s: 4, w: 1 }) }, cloud: cloud({ a: 10, s: 6, w: 9 }) });
  assert.equal(r.from, "cloud", "作答筆數平手比練過題數");
  r = R({ exp: mk(), local: { raw: save({ a: 10, s: 6, w: 1 }) }, cloud: cloud({ a: 10, s: 6, w: 9 }) });
  assert.equal(r.from, "local", "全平手用本機");
  const same = save({ w: 4 });
  r = R({ exp: mk(), local: { raw: same }, cloud: { rev: 2, data: same, updated: NOW } });
  assert.equal(r.from, "local");
  r = R({ exp: mk(), local: { raw: null }, cloud: cloud({ w: 3 }) });
  assert.equal(r.from, "cloud"); assert.equal(r.updated, Date.UTC(2026, 9, 19, 13, 30));
});

test("本機有數字但雲端讀不到或讀取中：照用本機並註明", () => {
  assert.equal(W.sourceText(R({ exp: mk(), local: { raw: save() }, cloud: "fail" })), "依這台裝置的紀錄（雲端暫時讀不到，可能不是最新）");
  assert.equal(W.sourceText(R({ exp: mk(), local: { raw: save() }, cloud: "pending" })), "依這台裝置的紀錄（雲端讀取中）");
});

test("雲端回應驗證：rev 0 必須 data／updated 為 null；rev>0 必須字串與時間", () => {
  assert.ok(W.okCloud({ ok: true, rev: 0, data: null, updated: null }));
  assert.ok(W.okCloud({ ok: true, rev: 3, data: "{}", updated: 1 }));
  [{ ok: true, rev: 0, data: "{}", updated: null }, { ok: true, rev: 3, data: null, updated: 1 }, { ok: true, rev: 3, data: "{}", updated: null },
    { ok: false, rev: 3, data: "{}", updated: 1 }, { ok: true, rev: -1, data: null, updated: null }, { ok: true, rev: 1.5, data: "{}", updated: 1 },
    { ok: true, items: [] }, null, "x", []].forEach((x) => assert.ok(!W.okCloud(x), JSON.stringify(x)));
});

test("總數：只加有數字的科目、只加範圍內（不加 challenge、不加 out）", () => {
  const rows = [
    R({ exp: mk(), local: { raw: save({ w: 21, wt: 21, c: 4, ct: 4, o: 1 }) } }),
    W.resolve(W.SUBJECTS[1], { exp: mk({ key: "g5math.v2" }), local: { raw: save({ w: 2, wt: 2, c: 0, ct: 0, o: 5 }) } }, NOW),
    W.resolve(W.SUBJECTS[2], { exp: null }, NOW),
    W.resolve(W.SUBJECTS[3], { exp: undefined }, NOW),
  ];
  const P = W.panel(rows);
  assert.equal(P.total, 23);
  assert.equal(P.measured, 2);
  assert.deepEqual(P.na, ["國語"]);
  assert.equal(P.loading, 1);
  assert.deepEqual(P.challenge.map((r) => r.name), ["自然"]);
  assert.equal(W.challengeText(P.challenge[0]), "4 題");
});

test("深連結：只接受該站自己的網址，其他一律當沒有", () => {
  const ok = "https://windsorya.github.io/g5-sci-review/#go=weak";
  let r = R({ exp: mk({ links: { weak: ok, challenge: ok.replace("weak", "challenge") } }), local: { raw: save() } });
  assert.equal(r.links.weak, ok);
  assert.equal(r.links.challenge, "https://windsorya.github.io/g5-sci-review/#go=challenge");
  ["https://windsorya.github.io/g5-math-review/#go=weak", "https://evil.example/g5-sci-review/", "javascript:alert(1)",
    "https://windsorya.github.io/g5-sci-review/\"><script>", 7, null,
    // Codex 審 b2380e0 P2：前綴對、正規化後其實是別站
    "https://windsorya.github.io/g5-sci-review/../g5-math-review/#go=weak", "https://windsorya.github.io/g5-sci-review/%2e%2e/g5-math-review/#go=weak",
    "https://windsorya.github.io/g5-sci-review/%2E%2E/g5-math-review/", "https://windsorya.github.io/g5-sci-review/.%2e/g5-math-review/"].forEach((u) => {
    r = R({ exp: mk({ links: { weak: u, challenge: u } }), local: { raw: save() } });
    assert.equal(r.links.weak, null, String(u)); assert.equal(r.links.challenge, null, String(u));
  });
  r = R({ exp: mk({ links: undefined }), local: { raw: save() } });
  assert.deepEqual(r.links, { weak: null, challenge: null });
  // getter 丟例外也不讓整頁壞掉
  const evil = mk(); Object.defineProperty(evil, "links", { get() { throw new Error("x"); } });
  assert.deepEqual(R({ exp: evil, local: { raw: save() } }).links, { weak: null, challenge: null });
});

test("自檢：resolve 若把 out 加進總數，總數測試要抓得到（突變）", () => {
  const rows = [R({ exp: mk(), local: { raw: save({ w: 1, wt: 1, c: 0, ct: 0, o: 9 }) } })];
  const mutated = rows.reduce((n, r) => n + r.sum.weak + r.sum.out, 0);
  assert.notEqual(W.panel(rows).total, mutated);
});

test("採用的深連結是正規化後的網址，且仍在本站（Codex 審 b2380e0 P2）", () => {
  const r = R({ exp: mk({ links: { weak: "https://windsorya.github.io/g5-sci-review/./a/../#go=weak", challenge: null } }), local: { raw: save() } });
  assert.equal(r.links.weak, "https://windsorya.github.io/g5-sci-review/#go=weak");
});

test("科目站函式回傳不合介面＝格式不對；回 {ok:false} 或丟例外＝讀不懂（Codex 審 b2380e0 P3，設計書第 2 節）", () => {
  const ret = (v) => mk({ summarize() { return v; } });
  const malformed = [{ ok: true, answers: 1, seen: 1, weak: 3, weakToday: 4, challenge: 0, challengeToday: 0, out: 0 },
    { ok: true, answers: 1 }, { ok: true, answers: -1, seen: 1, weak: 0, weakToday: 0, challenge: 0, challengeToday: 0, out: 0 },
    { ok: "yes" }, {}, null, undefined, 3, "x", []];
  malformed.forEach((v) => {
    assert.equal(W.summarize(ret(v), "{}", NOW), "format", JSON.stringify(v));
    const r = R({ exp: ret(v), local: { raw: "{}" }, cloud: "nocode" });
    assert.equal(r.state, "na"); assert.equal(r.why, "量不到：自然站提供的題數資料格式不對", JSON.stringify(v));
  });
  assert.equal(W.summarize(ret({ ok: false }), "{}", NOW), null);
  assert.match(R({ exp: ret({ ok: false }), local: { raw: "{}" }, cloud: "nocode" }).why, /紀錄讀不懂/);
  // 一份格式不對、另一份讀得懂 ⇒ 用讀得懂那份
  const exp = mk({ summarize(raw) { return raw === "fmt" ? { ok: true } : mk().summarize(raw); } });
  const r = R({ exp, local: { raw: "fmt" }, cloud: { rev: 2, data: save({ w: 5, wt: 5 }), updated: NOW } });
  assert.equal(r.state, "ok"); assert.equal(r.sum.weak, 5);
  // 格式不對但雲端還在讀 ⇒ 先等雲端
  assert.equal(R({ exp, local: { raw: "fmt" }, cloud: "pending" }).state, "loading");
});

test("resolve.kind：W.pick 排序依據——載不到／格式不對（介面或題數）／介面合格但紀錄量不到（讀不懂、沒紀錄）", () => {
  const cnt = mk({ summarize(raw) { const s = mk().summarize(raw); s.weakToday = s.weak + 1; return s; } });
  const src = { local: { raw: save() }, cloud: "nocode" };
  assert.equal(R(Object.assign({}, src, { exp: null })).kind, "unreachable");
  assert.equal(R(Object.assign({}, src, { exp: "bad" })).kind, "format");
  assert.equal(R(Object.assign({}, src, { exp: mk({ api: 2 }) })).kind, "format");
  assert.equal(R(Object.assign({}, src, { exp: cnt })).kind, "format");
  assert.equal(R({ exp: mk(), local: { raw: save({ bad: 1 }) }, cloud: "nocode" }).kind, "unmeasured");
  assert.equal(R({ exp: mk({ summarize() { throw new Error("x"); } }), local: { raw: save() }, cloud: "nocode" }).kind, "unmeasured");
  assert.equal(R({ exp: mk(), local: { raw: null }, cloud: "nocode" }).kind, "unmeasured");
  // 雲端那份格式錯但本機可算：ok（不因另一份格式錯就整科量不到）
  const fmtCloud = mk({ summarize(raw) { return raw === "fmt" ? { ok: true } : mk().summarize(raw); } });
  assert.equal(R({ exp: fmtCloud, local: { raw: save() }, cloud: { rev: 2, data: "fmt", updated: NOW } }).state, "ok");
});
