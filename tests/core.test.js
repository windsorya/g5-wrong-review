// 錯題複習核心測試：node --test tests/*.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../src/core.js");

const D0 = "2026-10-13";
const item = (o) => Object.assign({ id: "w-t-1", subject: "數學", source: "10/8 數學小考", added: D0, type: "choice", q: "1/2 和 2/4 哪個大？", opts: ["1/2", "2/4", "一樣大"], a: 2, why: "2/4 約分後就是 1/2。" }, o);

test("日期：台北時區、跨月、閏年", () => {
  assert.equal(C.dayKey(Date.parse("2026-10-12T16:30:00Z")), "2026-10-13");   // 台北 00:30
  assert.equal(C.dayKey(Date.parse("2026-10-12T15:59:00Z")), "2026-10-12");
  assert.equal(C.addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(C.addDays("2028-02-28", 1), "2028-02-29");
  assert.ok(C.isDay("2026-10-13")); assert.ok(!C.isDay("2026-02-30")); assert.ok(!C.isDay("2026-1-3")); assert.ok(!C.isDay(null));
});

test("題目檢查：合格題沒有問題，各種壞資料都抓得到", () => {
  assert.deepEqual(C.itemProblems(item()), []);
  assert.deepEqual(C.itemProblems(item({ type: "tf", a: false, opts: undefined })), []);
  assert.deepEqual(C.itemProblems(item({ type: "fill", a: ["0.5", "1/2"], opts: undefined })), []);
  const bad = [
    null, item({ id: "有 空白" }), item({ subject: "體育" }), item({ source: " " }), item({ added: "2026-13-01" }),
    item({ type: "essay" }), item({ q: "" }), item({ why: "" }), item({ opts: ["只有一個"] }), item({ a: 3 }), item({ a: 1.5 }),
    item({ opts: ["A", "Ａ", "B"] }), item({ type: "tf", a: "true" }), item({ type: "fill", a: [] }), item({ type: "fill", a: "0.5" }), item({ type: "fill", a: [" "] }),
  ];
  bad.forEach((b, i) => assert.ok(C.itemProblems(b).length > 0, "第 " + i + " 個壞資料沒被抓到"));
});

test("答案比對：選擇、是非、填充（全形、空白、句點、大小寫）", () => {
  assert.ok(C.isRight(item(), 2)); assert.ok(!C.isRight(item(), 0)); assert.ok(!C.isRight(item(), "2"));
  const tf = item({ type: "tf", a: false });
  assert.ok(C.isRight(tf, false)); assert.ok(!C.isRight(tf, true));
  const f = item({ type: "fill", a: ["0.5", "1/2"] });
  ["0.5", "０．５", " 1 / 2 ", "1/2。"].forEach((x) => assert.ok(C.isRight(f, x), x));
  ["", "  ", "0.6", null].forEach((x) => assert.ok(!C.isRight(f, x), String(x)));
  assert.ok(C.isRight(item({ type: "fill", a: ["Apple"] }), "apple"));
  assert.equal(C.answerText(item()), "一樣大"); assert.equal(C.answerText(tf), "錯（×）"); assert.equal(C.answerText(f), "0.5");
});

test("排程：對 1 天隔 1 天、連 2 天隔 3 天、連 3 個不同天＝學會隔 7 天", () => {
  let st = C.blank(), r;
  r = C.record(st, "a", true, D0); st = r.state;
  assert.ok(r.counted); assert.equal(st.it.a.s, 1); assert.equal(st.it.a.due, "2026-10-14"); assert.equal(st.it.a.m, false);
  st = C.record(st, "a", true, "2026-10-14").state; assert.equal(st.it.a.s, 2); assert.equal(st.it.a.due, "2026-10-17");
  st = C.record(st, "a", true, "2026-10-17").state; assert.equal(st.it.a.s, 3); assert.equal(st.it.a.m, true); assert.equal(st.it.a.due, "2026-10-24");
  st = C.record(st, "a", true, "2026-10-24").state; assert.equal(st.it.a.s, 3); assert.equal(st.it.a.m, true); assert.equal(st.it.a.due, "2026-10-31");
  assert.equal(st.it.a.n, 4); assert.equal(st.it.a.ok, 4);
});

test("同一天重做不算進度：當天連按三次對也不會學會", () => {
  let st = C.blank();
  for (let k = 0; k < 3; k++) st = C.record(st, "a", true, D0).state;
  assert.equal(st.it.a.s, 1); assert.equal(st.it.a.m, false); assert.equal(st.it.a.n, 3);
  const r = C.record(st, "a", true, D0); assert.equal(r.counted, false);
});

test("答錯：歸零、明天再出；當天先錯後對仍算錯", () => {
  let st = C.blank();
  st = C.record(st, "a", true, D0).state;
  st = C.record(st, "a", false, "2026-10-14").state; assert.equal(st.it.a.s, 0); assert.equal(st.it.a.due, "2026-10-15");
  st = C.record(st, "a", true, "2026-10-14").state; assert.equal(st.it.a.s, 0); assert.equal(st.it.a.due, "2026-10-15");
  assert.equal(st.it.a.bad, 1); assert.equal(st.it.a.ok, 2);
});

test("學會的題目當天又做錯：取消學會、明天再出", () => {
  let st = C.blank();
  ["2026-10-13", "2026-10-14", "2026-10-17"].forEach((d) => { st = C.record(st, "a", true, d).state; });
  assert.ok(st.it.a.m);
  st = C.record(st, "a", false, "2026-10-17").state;
  assert.equal(st.it.a.m, false); assert.equal(st.it.a.s, 0); assert.equal(st.it.a.due, "2026-10-18");
});

test("學會的題當天又做錯：回報 counted=true（進度確實變了，畫面不可說不影響）——Codex 審 151f6f09", () => {
  let st = C.blank();
  ["2026-10-13", "2026-10-14", "2026-10-17"].forEach((d) => { st = C.record(st, "a", true, d).state; });
  assert.equal(C.record(st, "a", false, "2026-10-17").counted, true);
  assert.equal(C.record(st, "a", true, "2026-10-17").counted, false);   // 同一天再答對才是真的不影響
});

test("record 不改到傳進來的舊 state", () => {
  const st = C.blank(), before = JSON.stringify(st);
  C.record(st, "a", true, D0);
  assert.equal(JSON.stringify(st), before);
});

test("今天該練：新題與到期題；錯越多越前面、新題在前、再照加入日", () => {
  const items = [item({ id: "old", added: "2026-10-01" }), item({ id: "new2", added: "2026-10-12" }), item({ id: "new1", added: "2026-10-11" }), item({ id: "wait" }), item({ id: "bad" })];
  let st = C.blank();
  st = C.record(st, "wait", true, D0).state;                         // 明天才到期
  st = C.record(st, "bad", false, "2026-10-11").state; st = C.record(st, "bad", false, "2026-10-12").state;   // 錯兩次、已到期
  st = C.record(st, "old", false, "2026-10-12").state;               // 錯一次、已到期
  assert.deepEqual(C.dueList(items, st, D0).map((x) => x.id), ["bad", "old", "new1", "new2"]);
  assert.deepEqual(C.dueList(items, st, "2026-10-14").map((x) => x.id), ["bad", "old", "new1", "new2", "wait"]);
});

test("考前總複習：該科每題都出（含學會、未到期），沒學會的在前；空字串＝全部科目", () => {
  const items = [item({ id: "m1", added: "2026-10-01" }), item({ id: "m2", added: "2026-10-02" }), item({ id: "c1", subject: "國語" })];
  let st = C.blank();
  ["2026-10-01", "2026-10-02", "2026-10-05"].forEach((d) => { st = C.record(st, "m1", true, d).state; });
  assert.deepEqual(C.examList(items, st, "數學").map((x) => x.id), ["m2", "m1"]);
  assert.deepEqual(C.examList(items, st, "").map((x) => x.id), ["m2", "c1", "m1"]);   // m2 加入 10/02 早於 c1 的 10/13；學會的 m1 排最後
  assert.deepEqual(C.examList(items, st, "英文"), []);
  const S = C.stats(items, st, "2026-10-06");
  assert.deepEqual(S["數學"], { total: 2, mastered: 1, due: 1 }); assert.deepEqual(S["國語"], { total: 1, mastered: 0, due: 1 });
});

test("讀進來的紀錄：壞掉的欄位丟掉，不弄壞整頁（v1 遷移與 v2 同一套欄位整理）", () => {
  ["null", '{"v":3,"it":{}}', '"x"'].forEach((raw) => assert.equal(C.decode(raw).ok, false, raw));   // 讀不懂≠空白（設計書第 7 條）
  assert.deepEqual(C.decode(null).st, C.blank());
  [1, 2].forEach((v) => {
    const d = C.decode(JSON.stringify({ v, settings: { sound: false, tone: 99 }, it: {
      ok1: { n: 3, ok: 2, bad: 1, s: 9, m: true, last: "2026-10-13", due: "2026-10-20", log: [["2026-10-13", 1], ["壞", 1], ["2026-10-12", 5]] },
      "壞 id": { n: 1 }, nul: null, neg: { n: -1, ok: "3", due: "明天" },
    } }));
    assert.equal(d.ok, true); const c = d.st;
    assert.deepEqual(Object.keys(c.it).sort(), ["neg", "ok1"]);
    assert.equal(c.it.ok1.s, C.MASTER); assert.deepEqual(c.it.ok1.log, [["2026-10-13", 1]]);
    assert.equal(c.it.neg.n, 0); assert.equal(c.it.neg.ok, 0); assert.equal(c.it.neg.due, "");
    assert.equal(c.settings.sound, false); assert.equal(c.settings.tone, 0); assert.equal(c.v, 2);
  });
});

test("紀錄長度上限：最多留 LOG_MAX 筆", () => {
  let st = C.blank();
  for (let k = 0; k < C.LOG_MAX + 15; k++) st = C.record(st, "a", k % 2 === 0, C.addDays(D0, k)).state;
  assert.equal(st.it.a.log.length, C.LOG_MAX);
});

test("狀態文字：還沒練、今天要練、等幾天、學會", () => {
  const it = item({ id: "a" });
  let st = C.blank();
  assert.equal(C.status(st, it, D0).key, "new");
  st = C.record(st, "a", true, D0).state;
  assert.equal(C.status(st, it, D0).key, "wait"); assert.match(C.status(st, it, D0).text, /10\/14/);
  assert.equal(C.status(st, it, "2026-10-14").key, "due");
  ["2026-10-14", "2026-10-17"].forEach((d) => { st = C.record(st, "a", true, d).state; });
  assert.equal(C.status(st, it, "2026-10-17").key, "done");
});

test("不用再練（隱藏）：只藏不刪、可恢復、不改舊 state", () => {
  const items = [item({ id: "a" }), item({ id: "b" })];
  const st0 = C.blank();
  const st1 = C.setHidden(st0, "a", true);
  assert.deepEqual(C.visible(items, st1).map((x) => x.id), ["b"]);
  assert.deepEqual(st0.hidden, {});
  const st2 = C.setHidden(st1, "a", false);
  assert.deepEqual(C.visible(items, st2).map((x) => x.id), ["a", "b"]);
  assert.equal(C.visible(items, { v: 2, it: {} }).length, 2);   // 沒有 hidden 欄也照常
  assert.deepEqual(st2.hidden, {});                               // 恢復＝拿掉，不留負數時間戳
});

test("清除全部作答紀錄：進度歸零，保留提示音設定與隱藏名單", () => {
  let st = C.blank();
  st = C.record(st, "a", true, D0).state;
  st.settings = { sound: false, tone: 4 };
  st = C.setHidden(st, "b", true);
  const r = C.resetProgress(st);
  assert.deepEqual(r.it, {}); assert.deepEqual(r.settings, { sound: false, tone: 4 }); assert.ok(C.isHidden(r, "b"));
  assert.equal(Object.keys(st.it).length, 1);   // 不改舊的
});

test("讀進來的隱藏名單：v1 的 true／正數＝隱藏、負數＝已恢復；v2 只收合法 id 且值為 true", () => {
  const c = C.decode(JSON.stringify({ v: 1, it: {}, hidden: { ok: true, ts: 1760000000000, back: -5, zero: 0, str: "1", "壞 id": true } })).st;
  assert.deepEqual(c.hidden, { ok: true, ts: true });
  assert.ok(C.isHidden(c, "ok") && C.isHidden(c, "ts") && !C.isHidden(c, "back"));
  assert.equal(C.decode(JSON.stringify({ v: 1, it: {}, hidden: "x" })).ok, false);   // 容器型別不對＝讀不懂，不當空白
  assert.deepEqual(C.decode(JSON.stringify({ v: 2, it: {}, hidden: { a: true, b: 1, c: "true" } })).st.hidden, { a: true });
});

// ===== 原「逐題合併」反例（Codex 審 151f6f09、cf61e0ff）=====
// 2026-10-13 改為單一寫入分頁（Codex 設計者方案 b）後，merge() 已移除；同一批反例改用新語意驗證，放在 tests/storage.test.js：
//   合併①存不進去期間記憶體不被重讀蓋掉 → 07；②讀寫交錯 → 10（另一頁沒有寫入資格）與 02（接手後保存）；
//   ③別頁清除後舊紀錄不復活 → 03、16；④兩頁同答同一題 → 01、28（第二頁唯讀）；⑤舊版存檔 → 下面這支與 25、26。
test("合併⑤舊版存檔（沒有 t、hidden 是 true）：遷移不丟資料；之後清除才作廢", () => {
  const d = C.decode(JSON.stringify({ v: 1, it: { x: { n: 1, ok: 1, bad: 0, s: 1, m: false, last: "2026-10-13", due: "2026-10-14", log: [] } }, hidden: { y: true } }));
  assert.equal(d.from, 1);
  assert.deepEqual(Object.keys(d.st.it), ["x"]); assert.ok(C.isHidden(d.st, "y")); assert.equal(d.st.it.x.t, undefined);
  assert.deepEqual(C.resetProgress(d.st).it, {}); assert.ok(C.isHidden(C.resetProgress(d.st), "y"));
});
