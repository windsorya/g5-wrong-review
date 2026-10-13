// 存檔契約（Codex 設計者方案 b：Web Locks 單一寫入分頁）驗收矩陣 34 列的 node 版。
// 設計書：docs/storage-design-b-codex-designer-20261013.md 第 3、4 節。
// 替身：可控制的 storage（寫入前可暫停插入別頁動作、可令讀寫拋錯）、Web Locks（FIFO、ifAvailable）、時鐘與計時器、分頁間廣播（可丟棄）。
// 一個 controller＝一個分頁；兩個 controller 共用同一份 storage／locks／廣播＝同一瀏覽器的兩個分頁。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../src/core.js");

const KEY = "g5wrong.v1";
const T0 = Date.parse("2026-10-13T04:00:00Z");   // 台北 2026-10-13 中午
const TODAY = "2026-10-13";
const mk = (id, subject, added) => ({ id, subject, source: "小考", added, type: "choice", q: id + "？", opts: ["對", "錯"], a: 0, why: "因為。" });
const ITEMS = [mk("a", "數學", "2026-10-01"), mk("b", "國語", "2026-10-02"), mk("c", "自然", "2026-10-03"), mk("q", "社會", "2026-10-04")];
const SUBJ = { a: "數學", b: "國語", c: "自然", q: "社會" };
const entry = (o) => Object.assign({ n: 1, ok: 1, bad: 0, s: 1, m: false, last: "2026-10-12", due: "2026-10-13", log: [["2026-10-12", 1]] }, o);
const v2 = (it, hidden, settings) => JSON.stringify({ v: 2, it: it || {}, hidden: hidden || {}, settings: settings || { sound: true, tone: 0 } });

function Store(raw) {
  const m = new Map();
  if (raw !== undefined && raw !== null) m.set(KEY, raw);
  return {
    failSet: false, failGet: false, beforeSet: null, sets: 0,
    getItem(k) { if (this.failGet) throw new Error("讀取被拒"); return m.has(k) ? m.get(k) : null; },
    setItem(k, v) {
      if (this.beforeSet) { const f = this.beforeSet; this.beforeSet = null; f(k, v); }
      if (this.failSet) { const e = new Error("full"); e.name = "QuotaExceededError"; throw e; }
      this.sets++; m.set(k, String(v));
    },
    raw() { return m.has(KEY) ? m.get(KEY) : null; },
    D() { return JSON.parse(m.get(KEY)); },
  };
}
// Web Locks 替身：同名鎖同時只有一個持有者；排隊 FIFO；ifAvailable 在有人持有或排隊時回 null。callback 一律非同步呼叫（同真 API）。
function Locks() {
  let held = false; const queue = [];
  function run(cb, resolve, reject) {
    held = true;
    Promise.resolve().then(() => cb({ name: C.LOCK })).then((v) => { held = false; resolve(v); next(); }, (e) => { held = false; reject(e); next(); });
  }
  function next() { if (!held && queue.length) { const [cb, res, rej] = queue.shift(); run(cb, res, rej); } }
  return {
    request(name, opts, cb) {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      assert.equal(name, C.LOCK);
      return new Promise((resolve, reject) => {
        Promise.resolve().then(() => {
          if (opts.ifAvailable) {
            if (held || queue.length) { Promise.resolve().then(() => cb(null)).then(resolve, reject); return; }
            run(cb, resolve, reject); return;
          }
          if (!held && !queue.length) run(cb, resolve, reject); else queue.push([cb, resolve, reject]);
        });
      });
    },
    get held() { return held; },
  };
}
function Clock(t) {
  let id = 0; const q = new Map();
  const c = {
    T: t,
    set: (fn, ms) => { id++; q.set(id, { at: c.T + ms, fn }); return id; },
    clear: (i) => { q.delete(i); },
    pending: () => q.size,
    tick(ms) { c.T += ms; for (const [i, x] of [...q].sort((a, b) => a[1].at - b[1].at)) if (x.at <= c.T && q.has(i)) { q.delete(i); x.fn(); } },
  };
  return c;
}
function Bus() {
  const tabs = []; const b = { drop: false, add: (t) => tabs.push(t),
    post(from, m) { if (b.drop) return; tabs.forEach((t) => { if (t !== from) Promise.resolve().then(() => t.message(m)); }); } };
  return b;
}
function world(raw) { return { store: Store(raw), locks: Locks(), bus: Bus(), clock: Clock(T0) }; }
function tab(w, extra) {
  let ctl = null;
  const env = Object.assign({
    storage: w.store, locks: w.locks, items: ITEMS, now: () => w.clock.T,
    setTimeout: w.clock.set, clearTimeout: w.clock.clear, post: (m) => w.bus.post(ctl, m),
  }, extra || {});
  ctl = C.createController(env);
  w.bus.add(ctl); ctl.boot();
  return ctl;
}
const flush = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };
const M = (ctl) => ctl.view().st;
const ids = (o) => Object.keys(o).sort();
// 練一題：開那一科的考前總複習（每科只有一題）→ 作答 → 回首頁
function practice(ctl, id, right = true) {
  const s = ctl.startExam(ctl.token(), SUBJ[id]);
  if (!s.ok) return s;
  const r = ctl.answer(ctl.token(), right ? 0 : 1);
  ctl.home(ctl.token());
  return r;
}
async function takeover(from, to) { to.askTakeover(); await flush(); assert.equal(to.view().mode, "READY", "接手後應可寫"); assert.equal(from.view().writer, false); }

// ---------- 01–03 多頁 ----------
test("01／R1 多頁漏存：A 答 a、b；B 嘗試答 c ⇒ B 唯讀，D 只有 a、b 各一次", async () => {
  const w = world(); const A = tab(w); await flush(); const B = tab(w); await flush();
  assert.equal(A.view().mode, "READY"); assert.equal(B.view().mode, "RO");
  assert.ok(practice(A, "a").ok); assert.ok(practice(A, "b").ok);
  const s = B.startExam(B.token(), "自然"); assert.equal(s.ok, false); assert.equal(s.reason, "ro"); assert.match(s.msg, /另一個分頁正在練習，請回那一頁/);
  const r = B.answer({ gen: B.view().gen, qid: "c" }, 0); assert.equal(r.ok, false); assert.equal(r.reason, "ro");
  assert.deepEqual(ids(w.store.D().it), ["a", "b"]); assert.equal(w.store.D().it.a.n, 1); assert.equal(w.store.D().it.b.n, 1);
  assert.equal(B.view().sess, null);
});

test("02／接手保存：A 存妥回首頁讓出 ⇒ B 重新讀取後答 c，D＝a、b、c 各一次", async () => {
  const w = world(); const A = tab(w); await flush(); const B = tab(w); await flush();
  practice(A, "a"); practice(A, "b");
  assert.equal(B.answer(B.token(), 0).ok, false);   // 接手前不能作答
  await takeover(A, B);
  assert.deepEqual(ids(M(B).it), ["a", "b"]);         // 重新讀了存檔，不是沿用等待期間的快照
  assert.ok(practice(B, "c").ok);
  const D = w.store.D(); assert.deepEqual(ids(D.it), ["a", "b", "c"]); ["a", "b", "c"].forEach((k) => assert.equal(D.it[k].n, 1));
  assert.equal(practice(A, "q").reason, "ro");          // 讓出的那頁變唯讀
});

test("03／R1 清除復活：A 清除；B 舊操作答 c 被拒；B 接手後只有 c", async () => {
  const w = world(v2({ a: entry(), b: entry() })); const A = tab(w); await flush(); const B = tab(w); await flush();
  const oldTok = B.token();
  assert.ok(A.reset(A.token()).ok);
  assert.equal(B.answer(oldTok, 0).reason, "ro"); assert.equal(B.startExam(oldTok, "自然").reason, "ro");
  assert.deepEqual(w.store.D().it, {});
  await takeover(A, B);
  assert.ok(practice(B, "c").ok);
  assert.deepEqual(ids(w.store.D().it), ["c"]);
});

// ---------- 04–06 單頁 ----------
test("04／R1 隱藏佇列題：開始 [a,b] 後把 b 隱藏，答 a、下一題 ⇒ b 不出、不記錄", async () => {
  const w = world(); const A = tab(w, { items: ITEMS.slice(0, 2) }); await flush();
  assert.ok(A.startExam(A.token(), "").ok); assert.deepEqual(A.view().sess.queue, ["a", "b"]);
  assert.ok(A.setHidden(A.token(), "b", true).ok);
  assert.equal(A.token().qid, "a"); assert.ok(A.answer(A.token(), 0).ok); assert.ok(A.next(A.token()).ok);
  assert.equal(A.token().qid, null); assert.ok(A.view().sess.i >= A.view().sess.queue.length);
  const D = w.store.D(); assert.equal(D.hidden.b, true); assert.equal(D.it.b, undefined);
});

test("05／R1 清除假成功：寫入拋錯時清除 ⇒ D、M 都保留 a，回報沒有清除成功", async () => {
  const w = world(v2({ a: entry() })); const A = tab(w); await flush();
  w.store.failSet = true;
  const r = A.reset(A.token());
  assert.equal(r.ok, false); assert.match(r.msg, /沒有清除成功/); assert.doesNotMatch(r.msg, /已清除/);
  assert.deepEqual(ids(w.store.D().it), ["a"]); assert.deepEqual(ids(M(A).it), ["a"]);
});

test("06／R1 進度提示：學會的 q 同日答錯 ⇒ n=4、bad+1、s=0、m=false、明天到期、算進度", async () => {
  const w = world(v2({ q: entry({ n: 3, ok: 3, bad: 0, s: 3, m: true, last: TODAY, due: TODAY }) })); const A = tab(w); await flush();
  A.startExam(A.token(), "社會"); const r = A.answer(A.token(), 1);
  assert.ok(r.ok); assert.equal(r.counted, true);
  const q = w.store.D().it.q; assert.equal(q.n, 4); assert.equal(q.bad, 1); assert.equal(q.s, 0); assert.equal(q.m, false); assert.equal(q.due, "2026-10-14");
});

// ---------- 07–08 寫入失敗 ----------
test("07／R2 未存答案：寫入持續失敗時答 a、b 留在記憶體；恢復後答 c ⇒ D＝a、b、c 各一次、警告消失", async () => {
  const w = world(); const A = tab(w); await flush();
  w.store.failSet = true;
  practice(A, "a"); practice(A, "b");
  assert.deepEqual(ids(M(A).it), ["a", "b"]); assert.equal(w.store.raw(), null); assert.equal(A.view().dirty, true);
  w.store.failSet = false;
  practice(A, "c");
  const D = w.store.D(); assert.deepEqual(ids(D.it), ["a", "b", "c"]); ["a", "b", "c"].forEach((k) => assert.equal(D.it[k].n, 1));
  assert.equal(A.view().dirty, false);
});

test("08／R2 清除抹掉未存答案：a 已存、b 未存；清除也失敗 ⇒ M={a,b}、D={a}、仍 DIRTY；重試後 D={a,b}，之後不會自動清空", async () => {
  const w = world(); const A = tab(w); await flush();
  practice(A, "a");
  w.store.failSet = true; practice(A, "b");
  const r = A.reset(A.token()); assert.equal(r.ok, false);
  assert.deepEqual(ids(M(A).it), ["a", "b"]); assert.deepEqual(ids(w.store.D().it), ["a"]); assert.equal(A.view().dirty, true);
  w.store.failSet = false;
  assert.equal(A.retrySave(), true);
  assert.deepEqual(ids(w.store.D().it), ["a", "b"]); assert.equal(A.view().dirty, false);
  w.clock.tick(60000); await flush();
  assert.deepEqual(ids(w.store.D().it), ["a", "b"]); assert.deepEqual(ids(M(A).it), ["a", "b"]);
});

// ---------- 09–11 跨頁交錯 ----------
test("09／R2 跨頁隱藏當前題：B 隱藏被拒；A 讓出後 B 隱藏成功；重播 A 舊答題事件被拒", async () => {
  const w = world(); const A = tab(w); await flush(); const B = tab(w); await flush();
  A.startExam(A.token(), "數學"); const oldTok = A.token(); assert.equal(oldTok.qid, "a");
  assert.equal(B.setHidden(B.token(), "a", true).reason, "ro"); assert.equal(w.store.raw(), null);
  A.home(A.token()); await takeover(A, B);
  assert.ok(B.setHidden(B.token(), "a", true).ok); assert.equal(w.store.D().hidden.a, true);
  const r = A.answer(oldTok, 0); assert.equal(r.ok, false); assert.equal(r.reason, "ro");
  assert.equal(w.store.D().it.a, undefined);
});

test("10／R2、R3 讀寫交錯：A 暫停在寫入前，B 嘗試答 b 並存檔 ⇒ B 沒有寫入資格、沒有任何 setItem；放行後只有 a", async () => {
  const w = world(); const A = tab(w); await flush(); const B = tab(w); await flush();
  A.startExam(A.token(), "數學");
  const seen = {};
  w.store.beforeSet = () => {
    const before = w.store.sets;
    seen.start = B.startExam(B.token(), "國語"); seen.ans = B.answer({ gen: B.view().gen, qid: "b" }, 0); seen.retry = B.retrySave();
    seen.hide = B.setHidden(B.token(), "b", true); seen.sets = w.store.sets - before;
  };
  assert.ok(A.answer(A.token(), 0).ok);
  assert.equal(seen.start.reason, "ro"); assert.equal(seen.ans.reason, "ro"); assert.equal(seen.retry, false); assert.equal(seen.hide.reason, "ro"); assert.equal(seen.sets, 0);
  assert.deepEqual(ids(w.store.D().it), ["a"]);
});

test("11／R2 讀取後被別頁清除：A 讀了舊紀錄停在寫入前，B 清除被拒；A 正常保存", async () => {
  const w = world(v2({ a: entry() })); const A = tab(w); await flush(); const B = tab(w); await flush();
  A.startExam(A.token(), "國語");
  let rb = null; w.store.beforeSet = () => { rb = B.reset(B.token()); };
  assert.ok(A.answer(A.token(), 0).ok);
  assert.equal(rb.ok, false); assert.equal(rb.reason, "ro"); assert.doesNotMatch(rb.msg, /已清除/);
  assert.deepEqual(ids(w.store.D().it), ["a", "b"]);
});

// ---------- 12–16 時鐘無關 ----------
test("12／R3 同毫秒清除：固定時間答 a 後不前進時鐘直接清除 ⇒ D、M 都空，重新載入仍空", async () => {
  const w = world(); const A = tab(w); await flush();
  practice(A, "a"); const r = A.reset(A.token());
  assert.ok(r.ok); assert.match(r.msg, /已清除/);
  assert.deepEqual(w.store.D().it, {}); assert.deepEqual(M(A).it, {});
  const w2 = Object.assign(world(), { store: w.store }); const A2 = tab(w2); await flush();
  assert.deepEqual(M(A2).it, {});
});

test("13／R3 回撥後清除：答 a、時鐘回撥一分鐘、清除 ⇒ 與 12 相同", async () => {
  const w = world(); const A = tab(w); await flush();
  practice(A, "a"); w.clock.T -= 60000;
  assert.ok(A.reset(A.token()).ok);
  assert.deepEqual(w.store.D().it, {}); assert.deepEqual(M(A).it, {});
});

test("14／R3 提示音被舊頁覆蓋：A 關音、B 作答被拒；B 接手作答後存檔仍 sound=false、答對不響", async () => {
  const w = world(); const A = tab(w); await flush(); const B = tab(w); await flush();
  assert.ok(A.setSound(A.token(), false, 0).ok); assert.equal(w.store.D().settings.sound, false);
  assert.equal(practice(B, "c").reason, "ro");
  assert.equal(w.store.D().settings.sound, false);
  await takeover(A, B);
  const r = practice(B, "c"); assert.ok(r.ok); assert.equal(r.chime, false);
  assert.equal(w.store.D().settings.sound, false); assert.equal(M(B).settings.sound, false);
});

test("15／R3 回撥後不能恢復：隱藏 a、時鐘回撥、恢復 a ⇒ 存檔 a 不隱藏，重新載入仍可見", async () => {
  const w = world(); const A = tab(w); await flush();
  A.setHidden(A.token(), "a", true); w.clock.T -= 60000; A.setHidden(A.token(), "a", false);
  assert.equal(w.store.D().hidden.a, undefined); assert.equal(C.isHidden(M(A), "a"), false);
  const w2 = Object.assign(world(), { store: w.store }); const A2 = tab(w2); await flush();
  assert.deepEqual(C.visible(ITEMS, M(A2)).map((x) => x.id), ["a", "b", "c", "q"]);
});

test("16／R3 同題舊累積復活：q 預存 n=3 m=true；A 舊 handler；B 接手清除後重答 q ⇒ n=1；A 舊事件被拒", async () => {
  const w = world(v2({ q: entry({ n: 3, ok: 3, s: 3, m: true, last: "2026-10-10", due: TODAY }) })); const A = tab(w); await flush(); const B = tab(w); await flush();
  A.startExam(A.token(), "社會"); const oldTok = A.token(); assert.equal(oldTok.qid, "q");
  A.home(A.token()); await takeover(A, B);
  assert.ok(B.reset(B.token()).ok); assert.ok(practice(B, "q").ok);
  assert.equal(w.store.D().it.q.n, 1); assert.equal(w.store.D().it.q.m, false);
  assert.equal(A.answer(oldTok, 0).ok, false);
  const q = w.store.D().it.q; assert.equal(q.n, 1); assert.equal(q.m, false);
});

// ---------- 17–21 清除、隱藏、提示音 ----------
test("17／清除的保留範圍：只有 it 清空；隱藏 b 與設定 {sound:false,tone:4} 保留；複習 session 結束", async () => {
  const w = world(v2({ a: entry() }, { b: true }, { sound: false, tone: 4 })); const A = tab(w); await flush();
  A.startExam(A.token(), "");
  assert.ok(A.reset(A.token()).ok);
  const D = w.store.D(); assert.deepEqual(D.it, {}); assert.deepEqual(D.hidden, { b: true }); assert.deepEqual(D.settings, { sound: false, tone: 4 });
  assert.equal(A.view().sess, null);
});

test("19／隱藏與恢復保留歷史：a 的 n/ok/bad/s/m/last/due/log 完全不變", async () => {
  const e = entry({ n: 5, ok: 3, bad: 2, s: 2, m: false, last: "2026-10-12", due: "2026-10-15", log: [["2026-10-11", 0], ["2026-10-12", 1]] });
  const w = world(v2({ a: e })); const A = tab(w); await flush();
  A.setHidden(A.token(), "a", true); A.setHidden(A.token(), "a", false);
  assert.deepEqual(w.store.D().it.a, e); assert.deepEqual(M(A).it.a, e);
  assert.deepEqual(C.dueList(ITEMS, M(A), TODAY).map((x) => x.id).includes("a"), false);   // 仍依原排程（10/15 才到期）
});

test("20／隱藏寫入失敗：隱藏目前未答的 a ⇒ M 隱藏並跳過、舊答案不計分、警告在；重試後 D 隱藏 a", async () => {
  const w = world(); const A = tab(w); await flush();
  A.startExam(A.token(), ""); const oldTok = A.token(); assert.equal(oldTok.qid, "a");
  w.store.failSet = true;
  assert.ok(A.setHidden(A.token(), "a", true).ok);
  assert.equal(C.isHidden(M(A), "a"), true); assert.notEqual(A.token().qid, "a"); assert.equal(A.view().dirty, true);
  assert.equal(A.answer(oldTok, 0).ok, false); assert.deepEqual(M(A).it, {});   // 舊 handler 不能記到 a，也不能記到現在這題
  assert.equal(A.view().sess.answered, false);
  w.store.failSet = false; assert.ok(A.retrySave());
  assert.equal(w.store.D().hidden.a, true); assert.equal(w.store.D().it.a, undefined);
});

test("21／提示音寫入失敗：sound:true,tone:4 時關音、再答題 ⇒ M.sound=false、tone 仍 4；重試後 D 一致", async () => {
  const w = world(v2({}, {}, { sound: true, tone: 4 })); const A = tab(w); await flush();
  w.store.failSet = true;
  assert.ok(A.setSound(A.token(), false, 4).ok);
  practice(A, "a");
  assert.deepEqual(M(A).settings, { sound: false, tone: 4 });
  w.store.failSet = false; w.clock.tick(5000); await flush();
  assert.deepEqual(w.store.D().settings, { sound: false, tone: 4 }); assert.equal(A.view().dirty, false);
});

// ---------- 22–27 載入、壞格式、遷移 ----------
test("22／啟動讀取失敗：READY 前一律不寫、顯示讀不到；再讀一次成功後才開放", async () => {
  const w = world(v2({ a: entry() })); w.store.failGet = true; const A = tab(w); await flush();
  assert.equal(A.view().mode, "READFAIL"); assert.match(A.view().msg, /讀不到原本紀錄，請再讀一次/);
  [A.startExam(A.token(), "數學"), A.answer({ gen: A.view().gen, qid: "a" }, 0), A.reset(A.token()), A.setSound(A.token(), false, 0), A.setHidden(A.token(), "a", true)]
    .forEach((r) => { assert.equal(r.ok, false); assert.equal(r.reason, "notready"); });
  assert.equal(A.retrySave(), false); assert.equal(w.store.sets, 0);
  w.store.failGet = false; assert.ok(A.reread().ok);
  assert.equal(A.view().mode, "READY"); assert.deepEqual(ids(M(A).it), ["a"]); assert.equal(w.store.sets, 0);
});

test("23／壞格式與未知版本：各 fixture 阻擋寫入、原文不變、顯示讀不懂", async () => {
  const fixtures = ["{壞掉", "[1,2]", "null", "\"字串\"", '{"v":2,"it":[]}', '{"v":2,"it":{},"hidden":"x"}', '{"v":2,"it":{},"settings":[]}', '{"v":1,"it":"x"}', '{"v":9,"it":{}}', '{"it":{}}'];
  for (const raw of fixtures) {
    const w = world(raw); const A = tab(w); await flush();
    assert.equal(A.view().mode, "BADFILE", raw); assert.match(A.view().msg, /讀不懂/, raw);
    assert.equal(A.startExam(A.token(), "數學").ok, false, raw); assert.equal(A.reset(A.token()).ok, false, raw); assert.equal(A.setSound(A.token(), false, 0).ok, false, raw);
    assert.equal(w.store.raw(), raw, raw); assert.equal(w.store.sets, 0, raw);
  }
});

test("23b／F4（Codex 審 1ed44f8）壞的單題紀錄 it.a=[]（v1、v2 各一）：BADFILE、改設定與作答都被拒、原文逐字不變", async () => {
  for (const v of [1, 2]) {
    const raw = JSON.stringify({ v, it: { a: [] }, hidden: {}, settings: { sound: false, tone: 4 } });
    const w = world(raw); const A = tab(w); await flush();
    assert.equal(A.view().mode, "BADFILE", raw); assert.match(A.view().msg, /讀不懂/, raw);
    assert.equal(A.setSound(A.token(), true, 2).ok, false, raw);
    assert.equal(A.startExam(A.token(), "數學").ok, false, raw);
    assert.equal(A.setHidden(A.token(), "b", true).ok, false, raw);
    assert.equal(A.reset(A.token()).ok, false, raw);
    assert.equal(w.store.raw(), raw, raw); assert.equal(w.store.sets, 0, raw);
  }
});

// F4b（Codex 審 449939b）：單題紀錄是物件、但欄位型別錯（n:[3] 等），原本被 cleanEntry 默默改成預設值、再把原文蓋掉。
// 判準：只接受歷代寫入程式實際寫出過的格式（151f6f0／cd31059／cf61e0f／1784419 的 v1、現行 v2），其他一律整份當壞檔。
const BAD_ENTRY = [
  { n: [3] }, { ok: "3" }, { bad: -1 }, { s: 4 }, { s: 1.5 }, { m: "true" }, { last: "2026-13-01" }, { due: 5 },
  { log: "x" }, { log: [["2026-10-12", 2]] }, { log: [["2026-10-12"]] }, { log: [["壞日期", 1]] }, { log: [["2026-10-12", 1, 9]] },
  { x: 1 }, { n: undefined }
];
const BAD_SETTINGS = [{ sound: "no", tone: 0 }, { sound: true, tone: "2" }, { sound: true, tone: 10 }, { sound: true, tone: 0, x: 1 }, { sound: true }];
test("23c／F4b（Codex 審 449939b）欄位型別錯誤（v1、v2 各一）：BADFILE、改設定與作答都被拒、原文逐字不變、零寫入", async () => {
  const raws = [];
  for (const v of [1, 2]) {
    for (const o of BAD_ENTRY) raws.push(JSON.stringify({ v, it: { a: entry(o) }, hidden: {}, settings: { sound: false, tone: 4 } }));
    for (const s of BAD_SETTINGS) raws.push(JSON.stringify({ v, it: { a: entry() }, hidden: {}, settings: s }));
    raws.push(JSON.stringify({ v, it: {}, hidden: {}, settings: { sound: true, tone: 0 }, foo: 1 }));                       // 多出不認得的頂層欄位
    raws.push(JSON.stringify({ v, it: { a: entry({ log: Array.from({ length: C.LOG_MAX + 1 }, () => ["2026-10-12", 1]) }) }, hidden: {}, settings: { sound: true, tone: 0 } }));
  }
  raws.push('{"v":2,"it":{"a":{"n":[3],"ok":3,"bad":0,"s":3,"m":true,"last":"2026-10-13","due":"2026-10-20","log":[]}},"hidden":{},"settings":{"sound":false,"tone":4}}');   // Codex 報告原例
  raws.push(JSON.stringify({ v: 2, it: { a: entry({ t: 5 }) }, hidden: {}, settings: { sound: true, tone: 0 } }));         // t 只有 v1 寫過
  raws.push('{"v":2,"it":{"__proto__":' + JSON.stringify(entry()) + '},"hidden":{},"settings":{"sound":true,"tone":0}}');  // __proto__ 寫進物件＝改原型
  raws.push('{"v":2,"it":{},"hidden":{"__proto__":true},"settings":{"sound":true,"tone":0}}');
  raws.push(JSON.stringify({ v: 2, it: {}, hidden: {}, resetAt: 0, settings: { sound: true, tone: 0 } }));                  // resetAt 只有 v1 寫過
  raws.push(JSON.stringify({ v: 1, it: { a: entry({ t: -1 }) }, hidden: {}, settings: { sound: true, tone: 0 } }));
  raws.push(JSON.stringify({ v: 1, it: { a: entry({ t: "9" }) }, hidden: {}, settings: { sound: true, tone: 0 } }));
  raws.push(JSON.stringify({ v: 1, it: {}, hidden: {}, resetAt: -1, settings: { sound: true, tone: 0 } }));
  raws.push(JSON.stringify({ v: 1, it: {}, hidden: {}, resetAt: "5", settings: { sound: true, tone: 0 } }));
  for (const raw of raws) {
    assert.equal(C.decode(raw).ok, false, "decode 應擋下：" + raw);
    const w = world(raw); const A = tab(w); await flush();
    assert.equal(A.view().mode, "BADFILE", raw); assert.match(A.view().msg, /讀不懂/, raw);
    assert.equal(A.setSound(A.token(), true, 2).ok, false, raw);
    assert.equal(A.startExam(A.token(), "數學").ok, false, raw);
    assert.equal(A.reset(A.token()).ok, false, raw);
    assert.equal(w.store.raw(), raw, raw); assert.equal(w.store.sets, 0, raw);
  }
});

test("23d／歷代寫入程式寫出過的合法格式都讀得懂、內容不被改動（防擋過頭的對照組）", () => {
  const e = entry(), keep = (d, id) => { const x = Object.assign({}, d.st.it[id]); return x; };
  const legal = [
    { raw: JSON.stringify({ v: 1, it: { a: e }, settings: { sound: true, tone: 0 } }), from: 1 },                                   // 151f6f0：沒有 hidden
    { raw: JSON.stringify({ v: 1, it: { a: e }, hidden: { b: true }, settings: { sound: false, tone: 9 } }), from: 1, hid: ["b"] },  // cd31059／cf61e0f
    { raw: JSON.stringify({ v: 1, it: { a: Object.assign({ t: 0 }, e), c: Object.assign({ t: 1791900000000 }, e) }, hidden: { b: 1791900000001, d: -1791900000002, f: 1 }, resetAt: 0, settings: { sound: true, tone: 3 } }), from: 1, hid: ["b", "f"] },   // 1784419
    { raw: JSON.stringify({ v: 2, it: { a: e }, hidden: { b: true }, settings: { sound: true, tone: 2 } }), from: 2, hid: ["b"] },
    { raw: JSON.stringify({ v: 2, it: { a: entry({ log: Array.from({ length: C.LOG_MAX }, () => ["2026-10-12", 0]) }) }, hidden: {}, settings: { sound: true, tone: 0 } }), from: 2 },
    { raw: JSON.stringify({ v: 2, it: { a: entry({ last: "", due: "", log: [], n: 0, ok: 0, bad: 0, s: 0 }) }, hidden: {}, settings: { sound: true, tone: 0 } }), from: 2 },
  ];
  for (const L of legal) {
    const d = C.decode(L.raw), o = JSON.parse(L.raw);
    assert.equal(d.ok, true, L.raw); assert.equal(d.from, L.from, L.raw);
    Object.keys(o.it).forEach((id) => { const want = Object.assign({}, o.it[id]); delete want.t; assert.deepEqual(keep(d, id), want, L.raw); });
    assert.deepEqual(Object.keys(d.st.hidden).sort(), (L.hid || []).sort(), L.raw);
    assert.deepEqual(d.st.settings, o.settings, L.raw);
  }
});

test("24／真正沒有存檔：可開始、答題前不寫空白 key；首次答案後 D.it.a.n=1", async () => {
  const w = world(); const A = tab(w); await flush();
  assert.equal(A.view().mode, "READY"); assert.equal(w.store.raw(), null); assert.equal(w.store.sets, 0);
  practice(A, "a"); assert.equal(w.store.D().it.a.n, 1); assert.equal(w.store.D().v, 2);
});

test("25／舊格式遷移：保留作答欄位與設定、隱藏轉布林、寫成 v2 後才 READY、再載入不重複遷移", async () => {
  const a = { n: 2, ok: 1, bad: 1, s: 1, m: false, last: "2026-10-01", due: "2026-10-02", log: [["2026-10-01", 1]] };
  const fixtures = [
    [{ v: 1, it: { a } }, { a }, {}, { sound: true, tone: 0 }],                                                     // 無 t、無 hidden
    [{ v: 1, it: { a }, hidden: { b: true } }, { a }, { b: true }, { sound: true, tone: 0 }],                       // hidden:true
    [{ v: 1, it: { a: Object.assign({ t: 5 }, a) }, hidden: { b: 1760000000000, c: -5, q: 3 }, settings: { sound: false, tone: 3 } }, { a }, { b: true, q: true }, { sound: false, tone: 3 }],
  ];
  for (const [old, it, hidden, settings] of fixtures) {
    const w = world(JSON.stringify(old)); const A = tab(w); await flush();
    assert.equal(A.view().mode, "READY");
    const D = w.store.D(); assert.equal(D.v, 2); assert.deepEqual(D.it, it); assert.deepEqual(D.hidden, hidden); assert.deepEqual(D.settings, settings);
    assert.deepEqual(M(A), D);
    const sets = w.store.sets, raw = w.store.raw();
    const w2 = Object.assign(world(), { store: w.store }); const A2 = tab(w2); await flush();
    assert.equal(A2.view().mode, "READY"); assert.equal(w.store.sets, sets); assert.equal(w.store.raw(), raw);
  }
});

test("26／舊清除標記遷移：resetAt=1000、t=999／1000／1001 ⇒ 保留 1000、1001；再清除全部歸零", async () => {
  const w = world(JSON.stringify({ v: 1, resetAt: 1000, it: { a: entry({ t: 999 }), b: entry({ t: 1000 }), c: entry({ t: 1001 }) } }));
  const A = tab(w); await flush();
  assert.deepEqual(ids(w.store.D().it), ["b", "c"]); assert.equal(w.store.D().it.b.t, undefined); assert.equal(w.store.D().resetAt, undefined);
  assert.ok(A.reset(A.token()).ok); assert.deepEqual(w.store.D().it, {});
});

test("27／遷移寫入失敗：原始 v1 逐字不變、不能答題；恢復後再讀一次成功且只轉一次", async () => {
  const raw = JSON.stringify({ v: 1, it: { a: entry() }, hidden: { b: true } });
  const w = world(raw); w.store.failSet = true; const A = tab(w); await flush();
  assert.equal(A.view().mode, "MIGRATEFAIL"); assert.equal(w.store.raw(), raw);
  assert.equal(A.startExam(A.token(), "國語").ok, false); assert.equal(A.answer({ gen: A.view().gen, qid: "b" }, 0).ok, false);
  w.store.failSet = false; assert.ok(A.reread().ok);
  assert.equal(A.view().mode, "READY"); const D = w.store.D(); assert.equal(D.v, 2); assert.deepEqual(ids(D.it), ["a"]); assert.deepEqual(D.hidden, { b: true });
  const sets = w.store.sets; const w2 = Object.assign(world(), { store: w.store }); tab(w2); await flush(); assert.equal(w.store.sets, sets);
});

// ---------- 28–31 鎖與重試 ----------
test("28／同時搶鎖：兩頁同時啟動 ⇒ 恰有一頁可寫，另一頁唯讀", async () => {
  const w = world(); const A = tab(w); const B = tab(w); await flush();
  const modes = [A.view().mode, B.view().mode].sort(); assert.deepEqual(modes, ["READY", "RO"]);
  const res = [A.startExam(A.token(), "數學").ok, B.startExam(B.token(), "國語").ok];
  assert.equal(res.filter(Boolean).length, 1);
});

test("29／背景凍結與通知遺失：A 持鎖、廣播被丟棄 ⇒ B 仍唯讀（不以逾時判死）；A 仍可保存", async () => {
  const w = world(); const A = tab(w); await flush(); const B = tab(w); await flush();
  w.bus.drop = true;
  B.askTakeover(); await flush(); w.clock.tick(10 * 60000); await flush();
  assert.equal(B.view().mode, "RO"); assert.equal(practice(B, "c").reason, "ro");
  assert.ok(practice(A, "a").ok); assert.deepEqual(ids(w.store.D().it), ["a"]);
});

test("30／無鎖能力：沒有 Web Locks ⇒ 顯示無法安全儲存、任何修改都不寫", async () => {
  const w = world(v2({ a: entry() })); const A = tab(w, { locks: null }); await flush();
  assert.equal(A.view().mode, "NOLOCK"); assert.match(A.view().msg, /無法安全儲存/);
  [A.startExam(A.token(), "數學"), A.reset(A.token()), A.setSound(A.token(), false, 0), A.setHidden(A.token(), "a", true)]
    .forEach((r) => { assert.equal(r.ok, false); assert.equal(r.reason, "nolock"); });
  assert.equal(w.store.sets, 0); assert.deepEqual(ids(M(A).it), ["a"]);   // 仍顯示既有紀錄（唯讀）
});

test("31／重試及重複事件：答案接受後寫失敗、重播同題 handler ⇒ n 只加一次；只推進重試計時器即存好", async () => {
  const w = world(); const A = tab(w); await flush();
  A.startExam(A.token(), "數學"); const tok = A.token();
  w.store.failSet = true;
  assert.ok(A.answer(tok, 0).ok); assert.equal(A.view().dirty, true);
  assert.equal(A.answer(tok, 0).ok, false); assert.equal(A.answer(tok, 1).ok, false);
  assert.equal(M(A).it.a.n, 1); assert.equal(w.clock.pending(), 1);   // 單一重試計時器
  w.store.failSet = false; w.clock.tick(3000); await flush();
  assert.equal(w.store.D().it.a.n, 1); assert.equal(A.view().dirty, false); assert.equal(w.clock.pending(), 0);
});

test("31c／重試計時器存檔不換世代：畫面據此保留輸入中的答案（F3 的核心前提）", async () => {
  const w = world(); const A = tab(w); await flush();
  w.store.failSet = true;
  A.startExam(A.token(), ""); A.answer(A.token(), 0); A.next(A.token());
  const tok = A.token(); assert.equal(tok.qid, "b");
  w.clock.tick(3000); await flush(); assert.deepEqual(A.token(), tok);   // 重試仍失敗
  w.store.failSet = false; w.clock.tick(3000); await flush();
  assert.deepEqual(A.token(), tok); assert.equal(A.view().dirty, false);   // 重試成功
  assert.ok(A.answer(tok, 0).ok);                                         // 原本那一題的 handler 仍可正常作答
});

test("31b／重試計時器失敗時只保留一個、寫的是當下完整 state（不重播答案）", async () => {
  const w = world(); const A = tab(w); await flush();
  w.store.failSet = true; practice(A, "a"); practice(A, "b");
  assert.equal(w.clock.pending(), 1); w.clock.tick(3000); assert.equal(w.clock.pending(), 1);
  w.store.failSet = false; w.clock.tick(3000);
  const D = w.store.D(); assert.deepEqual(ids(D.it), ["a", "b"]); assert.equal(D.it.a.n, 1); assert.equal(D.it.b.n, 1);
});

// ---------- 32–34 同步 ----------
test("32／同步不能繞過主頁：follower、練習中、DIRTY、本頁已有自己的變更時提出替換 ⇒ 全部拒絕、D/M 不變", async () => {
  const cloud = v2({ x: entry({ n: 9 }) });
  const w = world(v2({ a: entry() })); const A = tab(w); await flush(); const B = tab(w); await flush();
  const snap = () => [w.store.raw(), JSON.stringify(M(A))];
  let s0 = snap();
  assert.equal(B.canReplace(KEY), false); assert.equal(B.accept(KEY, cloud), false); assert.deepEqual(snap(), s0);   // follower
  A.startExam(A.token(), "數學"); s0 = snap();
  assert.equal(A.canReplace(KEY), false); assert.equal(A.accept(KEY, cloud), false); assert.deepEqual(snap(), s0);   // 練習中
  A.answer(A.token(), 0); A.home(A.token());
  assert.equal(A.canReplace(KEY), false); assert.equal(A.accept(KEY, cloud), false);                                 // 本頁已有自己的變更
  w.store.failSet = true; practice(A, "b"); s0 = snap(); w.store.failSet = false;
  assert.equal(A.view().dirty, true); assert.equal(A.canReplace(KEY), false); assert.equal(A.accept(KEY, cloud), false); assert.deepEqual(snap(), s0);   // DIRTY
  assert.equal(A.canReplace("g5help.v1"), false);
});

test("33／同步檢查後狀態改變：canReplace 先通過、孩子答 a 後才 accept ⇒ 重新檢查並拒絕，a 保留", async () => {
  const w = world(); const A = tab(w); await flush();
  assert.equal(A.canReplace(KEY), true);
  practice(A, "a");
  assert.equal(A.accept(KEY, v2({ x: entry() })), false);
  assert.deepEqual(ids(w.store.D().it), ["a"]); assert.deepEqual(ids(M(A).it), ["a"]);
});

test("34／首次下載與清除後下載：新裝置接受合法資料（寫失敗不公布）；清除後雲端舊資料被拒", async () => {
  const cloud = v2({ a: entry({ n: 5 }) }, { b: true }, { sound: false, tone: 2 });
  // 寫失敗：不公布
  let w = world(); let A = tab(w); await flush();
  w.store.failSet = true; assert.equal(A.accept(KEY, cloud), false); assert.deepEqual(M(A).it, {}); assert.equal(w.store.raw(), null);
  // 成功：主頁寫入、記憶體換上
  w = world(); A = tab(w); await flush();
  let changed = 0; const A1 = A; void A1;
  assert.equal(A.accept(KEY, cloud), true); assert.equal(w.store.raw(), cloud); assert.deepEqual(M(A), JSON.parse(cloud));
  assert.equal(A.accept(KEY, "{壞掉"), false); assert.equal(A.accept(KEY, JSON.stringify({ v: 1, it: {} })), false);   // 壞格式、舊格式不接
  // 清除後：已有 key，不得當新裝置重新下載舊進度
  w = world(v2({ a: entry({ n: 5 }) })); A = tab(w, { onChange: () => { changed++; } }); await flush();
  assert.ok(A.reset(A.token()).ok);
  assert.equal(A.accept(KEY, cloud), false); assert.deepEqual(w.store.D().it, {}); assert.deepEqual(M(A).it, {});
  assert.ok(changed > 0);
});

// ---------- 契約細節 ----------
test("契約 6：答案接受一次即消耗該題資格；換題、回首頁後舊 token 無效", async () => {
  const w = world(); const A = tab(w); await flush();
  A.startExam(A.token(), ""); const t1 = A.token();
  assert.ok(A.answer(t1, 0).ok); assert.equal(A.answer(t1, 0).ok, false);
  const t2 = A.token(); assert.ok(A.next(t2).ok); assert.equal(A.next(t2).ok, false);
  const t3 = A.token(); assert.ok(A.home(t3).ok); assert.equal(A.answer(t3, 0).ok, false);
  assert.equal(M(A).it.a.n, 1); assert.equal(M(A).it.b, undefined);
});

test("契約 6：回首頁（或清除）後重新開始同一題，舊畫面的 handler 不得作用（世代）", async () => {
  const w = world(); const A = tab(w); await flush();
  A.startExam(A.token(), "數學"); const old = A.token(); assert.equal(old.qid, "a");
  A.home(A.token()); A.startExam(A.token(), "數學"); assert.equal(A.token().qid, "a");
  assert.equal(A.answer(old, 0).ok, false); assert.deepEqual(M(A).it, {}); assert.equal(A.view().sess.answered, false);
  const old2 = A.token(); assert.ok(A.reset(A.token()).ok); A.startExam(A.token(), "數學");
  assert.equal(A.answer(old2, 0).ok, false); assert.deepEqual(M(A).it, {});
  assert.ok(A.answer(A.token(), 0).ok); assert.equal(M(A).it.a.n, 1);
});

test("契約 6：token 的題目 id 必須是現在這一題（同世代、不同題一律拒絕）", async () => {
  const w = world(); const A = tab(w); await flush();
  A.startExam(A.token(), ""); const gen = A.view().gen;
  assert.equal(A.answer({ gen, qid: "b" }, 0).ok, false); assert.equal(A.answer({ gen, qid: null }, 0).ok, false);
  assert.deepEqual(M(A).it, {}); assert.equal(A.view().sess.answered, false);
});

test("契約 2：練習中或有未存進度時不讓出；首頁且已存好才讓出", async () => {
  const w = world(); const A = tab(w); await flush(); const B = tab(w); await flush();
  A.startExam(A.token(), "數學");
  B.askTakeover(); await flush(); assert.equal(B.view().mode, "RO"); assert.equal(A.view().mode, "READY");
  A.answer(A.token(), 0); A.home(A.token());
  w.store.failSet = true; practice(A, "b");
  B.askTakeover(); await flush(); assert.equal(B.view().mode, "RO");
  w.store.failSet = false; A.retrySave();
  await takeover(A, B); assert.deepEqual(ids(M(B).it), ["a", "b"]);
});

test("decode：null＝沒有存檔；v2 正常；壞資料不當空白", () => {
  assert.deepEqual(C.decode(null), { ok: true, from: null, st: C.blank() });
  const d = C.decode(v2({ a: entry() })); assert.equal(d.ok, true); assert.equal(d.from, 2);
  assert.equal(C.decode("{").ok, false); assert.equal(C.decode('{"v":3}').ok, false);
});
