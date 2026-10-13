// 錯題複習核心（純函式，node 測試與網頁共用同一份）。
// 由來：2026-10-13 律師「加上錯題複習，專門複習我女兒在學校小考答錯的各科特定題目，希望能讓我上傳，以利之後考前或平常統一複習」。
// 規則（寫死在這裡，網頁只呼叫）：
//   ・每天第一次作答那一題才算數（同一天重做只算練習，不影響進度）——避免當天連按三次就「學會」。
//   ・答對一天 → 隔 1 天再出；連兩天對 → 隔 3 天；連三天（不同天）都對 → 學會，之後 7 天出一次保溫。
//   ・答錯 → 連對天數歸零、明天再出；當次複習的最後也會再出一次。
//   ・考前總複習：不看排程，出那一科（或全部）每一題，沒學會的排前面。
(function (root) {
  "use strict";
  var SUBJECTS = ["國語", "數學", "自然", "社會", "英文", "其他"];
  var TYPES = ["choice", "fill", "tf"];
  var MASTER = 3;               // 連續答對幾個不同天＝學會
  var GAP = [0, 1, 3];          // 連對 0／1／2 天時，隔幾天再出
  var KEEP = 7;                 // 學會後隔幾天出一次
  var LOG_MAX = 60;             // cap-why: 每題紀錄只留最近 60 筆，同步用的試算表單格上限 50000 字元，題數多時要留空間

  // 台北日期 YYYY-MM-DD（不依賴裝置時區）
  function dayKey(ms) {
    var d = new Date(ms + 8 * 3600000);
    return d.getUTCFullYear() + "-" + ("0" + (d.getUTCMonth() + 1)).slice(-2) + "-" + ("0" + d.getUTCDate()).slice(-2);
  }
  function addDays(day, n) {
    var p = day.split("-").map(Number), t = Date.UTC(p[0], p[1] - 1, p[2]) + n * 86400000, d = new Date(t);
    return d.getUTCFullYear() + "-" + ("0" + (d.getUTCMonth() + 1)).slice(-2) + "-" + ("0" + d.getUTCDate()).slice(-2);
  }
  function isDay(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && addDays(s, 0) === s; }

  // 題目檢查：回傳問題清單（空＝合格）。題庫測試與網頁載入都用這一支。
  function itemProblems(it) {
    var bad = [], s = function (x) { return typeof x === "string" && x.trim() !== ""; };
    if (!it || typeof it !== "object") return ["不是物件"];
    if (!s(it.id) || !/^[\w-]{1,60}$/.test(it.id) || it.id === "__proto__") bad.push("id 不合法");   // __proto__：存檔讀回會被當壞檔（見 okId）
    if (SUBJECTS.indexOf(it.subject) < 0) bad.push("科目不在清單：" + it.subject);
    if (!s(it.source)) bad.push("沒寫出處（哪一次小考）");
    if (!isDay(it.added)) bad.push("added 日期不合法");
    if (TYPES.indexOf(it.type) < 0) bad.push("type 不合法：" + it.type);
    if (!s(it.q)) bad.push("沒有題目");
    if (!s(it.why)) bad.push("沒有解說（為什麼）");
    if (it.type === "choice") {
      if (!Array.isArray(it.opts) || it.opts.length < 2 || !it.opts.every(s)) bad.push("選項至少兩個且不可空白");
      else {
        if (!(typeof it.a === "number" && it.a >= 0 && it.a < it.opts.length && Math.floor(it.a) === it.a)) bad.push("答案不是選項編號");
        var seen = {};
        it.opts.forEach(function (o) { if (seen[norm(o)]) bad.push("選項重複：" + o); seen[norm(o)] = 1; });
      }
    }
    if (it.type === "tf" && typeof it.a !== "boolean") bad.push("是非題答案要是 true／false");
    if (it.type === "fill") {
      if (!Array.isArray(it.a) || !it.a.length || !it.a.every(s)) bad.push("填充題答案要是非空字串陣列（可接受的寫法都列上）");
    }
    return bad;
  }

  // 填充題比對：去空白、全形英數轉半形、統一標點
  function norm(x) {
    return String(x == null ? "" : x)
      .replace(/[！-～]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/　/g, " ").replace(/\s+/g, "").replace(/[。．.]$/, "").toLowerCase();
  }
  function isRight(it, ans) {
    if (it.type === "choice") return ans === it.a;
    if (it.type === "tf") return ans === it.a;
    var n = norm(ans);
    return n !== "" && it.a.some(function (a) { return norm(a) === n; });
  }
  function answerText(it) {
    if (it.type === "choice") return it.opts[it.a];
    if (it.type === "tf") return it.a ? "對（○）" : "錯（×）";
    return it.a[0];
  }

  // hidden：爸媽按「不用再練」的題（2026-10-13 律師：「為何我測試用的題目，我沒法清除？有無清除或重置按鈕？」）——
  //   只藏起來不刪，清單底下可以恢復；題目本身寫在題庫程式裡，各台裝置都一樣，所以藏的是「這個家不練它」。
  // 存檔格式 v2（Codex 設計者方案 b，docs/storage-design-b-codex-designer-20261013.md）：
  //   {v:2, it:{題id: 作答紀錄}, hidden:{題id: true}, settings:{sound, tone}}。
  //   同一時間只有一個分頁能寫（Web Locks，見下方 createController），所以不再需要修改時間 t、清除標記 resetAt 與逐題合併：
  //   寫入＝把主頁記憶體整份存進去；舊版 v1 的 t／resetAt 只在遷移時用一次。
  var V = 2, KEY = "g5wrong.v1", LOCK = "g5wrong.v1:writer";
  function blank() { return { v: V, it: {}, hidden: {}, settings: { sound: true, tone: 0 } }; }
  function copy(x) { return JSON.parse(JSON.stringify(x)); }
  function isHidden(state, id) { return !!(state && state.hidden && state.hidden[id] === true); }
  function visible(items, state) { return items.filter(function (it) { return !isHidden(state, it.id); }); }
  function setHidden(state, id, on) {
    var st = copy(state);
    st.hidden = st.hidden || {};
    if (on) st.hidden[id] = true; else delete st.hidden[id];
    return st;
  }
  // 清除全部作答紀錄：進度歸零，保留提示音設定與「不用再練」名單（那是爸媽的選擇，不是作答紀錄）
  function resetProgress(state) {
    var st = blank();
    st.settings = copy(state.settings); st.hidden = copy(state.hidden || {});
    return st;
  }
  var ID = /^[\w-]{1,60}$/;
  function isObj(x) { return !!x && typeof x === "object" && !Array.isArray(x); }
  function isNat(x) { return Number.isInteger(x) && x >= 0; }
  // __proto__ 寫進物件會變成改原型、不是存資料 ⇒ 不當成合法的題目代號
  function okId(id) { return ID.test(id) && id !== "__proto__"; }
  var ENTRY_KEYS = ["n", "ok", "bad", "s", "m", "last", "due", "log"];
  // 一筆作答紀錄是否正是寫入程式寫得出來的樣子（嚴格檢查，不修正；用於 decode 判斷壞檔）
  function entryOk(e, ver) {
    if (!isObj(e)) return false;
    if (!Object.keys(e).every(function (k) { return ENTRY_KEYS.indexOf(k) >= 0 || (ver === 1 && k === "t"); })) return false;
    if (!ENTRY_KEYS.every(function (k) { return Object.prototype.hasOwnProperty.call(e, k); })) return false;
    if (!isNat(e.n) || !isNat(e.ok) || !isNat(e.bad) || !(isNat(e.s) && e.s <= MASTER) || typeof e.m !== "boolean") return false;
    if (!(e.last === "" || isDay(e.last)) || !(e.due === "" || isDay(e.due))) return false;
    if (ver === 1 && e.t !== undefined && !isNat(e.t)) return false;
    return Array.isArray(e.log) && e.log.length <= LOG_MAX &&
      e.log.every(function (l) { return Array.isArray(l) && l.length === 2 && isDay(l[0]) && (l[1] === 0 || l[1] === 1); });
  }
  function settingsOk(s) {
    return isObj(s) && Object.keys(s).every(function (k) { return k === "sound" || k === "tone"; }) &&
      typeof s.sound === "boolean" && Number.isInteger(s.tone) && s.tone >= 0 && s.tone < 10;
  }
  // 一筆作答紀錄的欄位整理：壞掉的欄位丟掉（設成預設值），不讓一筆壞資料弄壞整頁
  function cleanEntry(e) {
    var n = function (x) { return Number.isInteger(x) && x >= 0 ? x : 0; };
    return {
      n: n(e.n), ok: n(e.ok), bad: n(e.bad), s: Math.min(n(e.s), MASTER), m: e.m === true,
      last: isDay(e.last) ? e.last : "", due: isDay(e.due) ? e.due : "",
      log: Array.isArray(e.log) ? e.log.filter(function (l) { return Array.isArray(l) && isDay(l[0]) && (l[1] === 0 || l[1] === 1); }).slice(-LOG_MAX) : []
    };
  }
  function cleanSettings(raw) {
    var st = { sound: true, tone: 0 };
    if (isObj(raw)) {
      st.sound = raw.sound !== false;
      st.tone = Number.isInteger(raw.tone) && raw.tone >= 0 && raw.tone < 10 ? raw.tone : 0;
    }
    return st;
  }
  // 讀存檔（原始字串或 null）。回傳 {ok:true, from:null|1|2, st} 或 {ok:false}。
  //   null＝真的沒有存檔（新裝置）；from:1＝舊版，呼叫端要先把 st 寫成 v2 成功才能開放作答；
  //   壞 JSON、容器型別不對、未知版本 ⇒ ok:false，絕不當成空白（否則下一次存檔就把原本的紀錄蓋掉）。
  function decode(raw) {
    if (raw === null || raw === undefined) return { ok: true, from: null, st: blank() };
    var o;
    try { o = JSON.parse(raw); } catch (e) { return { ok: false }; }
    if (!isObj(o) || (o.v !== 1 && o.v !== 2)) return { ok: false };
    if ((o.it !== undefined && !isObj(o.it)) || (o.hidden !== undefined && !isObj(o.hidden)) || (o.settings !== undefined && !isObj(o.settings))) return { ok: false };
    var st = blank(), src = o.it || {}, hid = o.hidden || {};
    // 只接受歷代寫入程式實際寫出過的格式；任何一處讀不懂都整份當壞檔，讀檔時不「修正」任何欄位——
    // 修正後下一次存檔就把原文蓋掉（Codex 審 1ed44f8 F4：it.a=[] 被略過；449939b F4b：n:[3] 被改成 0）。
    // 歷代格式：151f6f0（v1，沒有 hidden）、cd31059／cf61e0f（v1，hidden＝true）、1784419（v1，加 resetAt 與每題 t，hidden＝非 0 的 ±時間戳）、
    // 現行 v2（沒有 t、沒有 resetAt，hidden＝true）。每題固定 8 欄：n／ok／bad／s／m／last／due／log。
    var TOP = o.v === 1 ? ["v", "it", "hidden", "settings", "resetAt"] : ["v", "it", "hidden", "settings"];
    if (!Object.keys(o).every(function (k) { return TOP.indexOf(k) >= 0; })) return { ok: false };
    if (o.v === 1 && o.resetAt !== undefined && !isNat(o.resetAt)) return { ok: false };
    var recOk = Object.keys(src).every(function (id) { return okId(id) && entryOk(src[id], o.v); });
    var hidOk = Object.keys(hid).every(function (id) {
      var x = hid[id];
      return okId(id) && (x === true || (o.v === 1 && typeof x === "number" && Number.isFinite(x) && x !== 0));
    });
    if (!recOk || !hidOk || (o.settings !== undefined && !settingsOk(o.settings))) return { ok: false };
    st.settings = cleanSettings(o.settings);
    if (o.v === 2) {
      Object.keys(hid).forEach(function (id) { st.hidden[id] = true; });
      Object.keys(src).forEach(function (id) { st.it[id] = cleanEntry(src[id]); });
      return { ok: true, from: 2, st: st };
    }
    // v1 遷移（設計書第 7 條）：hidden 為 true 或正數＝隱藏、負數＝已恢復；作答紀錄依舊判準 t >= resetAt 整理一次（缺少視為 0）。
    // 相等時間曾造成的清除歧義無法追溯推定，保留資料（讓家長重新清除）。
    var num = function (x) { return typeof x === "number" && Number.isFinite(x) ? x : 0; }, resetAt = num(o.resetAt);
    Object.keys(hid).forEach(function (id) { var x = hid[id]; if (x === true || x > 0) st.hidden[id] = true; });
    Object.keys(src).forEach(function (id) { var e = src[id]; if (num(e.t) >= resetAt) st.it[id] = cleanEntry(e); });
    return { ok: true, from: 1, st: st };
  }

  // 記一次作答。回傳新的 state（不改舊的），以及這次有沒有算進進度（counted）。
  function record(state, id, right, today) {
    var st = copy(state), e = st.it[id] || { n: 0, ok: 0, bad: 0, s: 0, m: false, last: "", due: "", log: [] };
    e.n += 1; if (right) e.ok += 1; else e.bad += 1;
    e.log.push([today, right ? 1 : 0]); if (e.log.length > LOG_MAX) e.log = e.log.slice(-LOG_MAX);
    var counted = e.last !== today;
    if (counted) {
      e.last = today;
      if (right) {
        e.s = Math.min(e.s + 1, MASTER);
        e.m = e.s >= MASTER;
        e.due = addDays(today, e.m ? KEEP : GAP[e.s]);
      } else {
        e.s = 0; e.m = false; e.due = addDays(today, 1);
      }
    } else if (!right && e.m) {
      // 學會的題目同一天又做錯：取消「學會」，明天再出（寧可多練一次）——進度確實變了，所以算進度（Codex 審 151f6f09：原本回報「不影響進度」與實際不符）
      e.m = false; e.s = 0; e.due = addDays(today, 1); counted = true;
    }
    st.it[id] = e;
    return { state: st, counted: counted };
  }

  function entry(state, id) { return state.it[id] || null; }
  function isDue(state, it, today) { var e = entry(state, it.id); return !e || !e.due || e.due <= today; }
  // 今天該複習的：從沒做過的、到期的。排序：錯最多次 → 從沒做過 → 加入日期早的
  function dueList(items, state, today) {
    return items.filter(function (it) { return isDue(state, it, today); }).sort(function (a, b) {
      var ea = entry(state, a.id), eb = entry(state, b.id);
      var wa = ea ? ea.bad : 0, wb = eb ? eb.bad : 0;
      if (wa !== wb) return wb - wa;
      if (!!ea !== !!eb) return ea ? 1 : -1;
      return a.added < b.added ? -1 : a.added > b.added ? 1 : (a.id < b.id ? -1 : 1);
    });
  }
  // 考前總複習：該科（subject 空＝全部）每一題，沒學會的在前，同一組內照加入日期
  function examList(items, state, subject) {
    return items.filter(function (it) { return !subject || it.subject === subject; }).sort(function (a, b) {
      var ma = !!(entry(state, a.id) || {}).m, mb = !!(entry(state, b.id) || {}).m;
      if (ma !== mb) return ma ? 1 : -1;
      return a.added < b.added ? -1 : a.added > b.added ? 1 : (a.id < b.id ? -1 : 1);
    });
  }
  // 每科統計：共幾題、學會幾題、今天到期幾題
  function stats(items, state, today) {
    var out = {};
    items.forEach(function (it) {
      var o = out[it.subject] || (out[it.subject] = { total: 0, mastered: 0, due: 0 });
      o.total += 1;
      if ((entry(state, it.id) || {}).m) o.mastered += 1;
      if (isDue(state, it, today)) o.due += 1;
    });
    return out;
  }
  function status(state, it, today) {
    var e = entry(state, it.id);
    if (!e || !e.n) return { key: "new", text: "還沒練過" };
    if (e.m) return { key: "done", text: "學會了（連 " + MASTER + " 天都對）" };
    if (e.due && e.due > today) return { key: "wait", text: "連對 " + e.s + " 天，" + e.due.slice(5).replace("-", "/") + " 再練" };
    return { key: "due", text: e.s ? "連對 " + e.s + " 天，今天要練" : "今天要練" };
  }

  // ===== 單一寫入分頁（Codex 設計者方案 b 的七條契約；node 測試 tests/storage.test.js 用替身驅動同一份程式）=====
  // ①取鎖且讀取成功（READY）才接受修改；其他分頁唯讀，每個操作入口都再檢查一次寫入資格。BroadcastChannel 只用來「請對方讓出」，不選主、不轉送答案。
  // ②接手一定重新讀存檔；主頁只在「首頁、沒有未存進度」時讓出；不以逾時搶鎖；沒有 Web Locks 就停用修改。
  // ③載入後主頁記憶體是唯一工作狀態：save() 直接把記憶體整份寫進去，不重讀、不合併。
  // ④寫入失敗：記憶體照留、標 DIRTY、單一重試計時器（每次寫當下完整 state，不重播答案）＋手動重試。
  // ⑤清除用候選狀態，寫成功才採用並結束複習；失敗什麼都不變。
  // ⑥每個畫面操作帶 token {gen, qid}：寫入資格、READY、世代、題目都對才接受；答案接受一次就消耗。
  // ⑦v1→v2 遷移寫成功才 READY；壞格式、未知版本不當空白、不寫。
  // env：storage（getItem/setItem）、locks（navigator.locks 或 null）、items、now()、setTimeout/clearTimeout、post(訊息給別的分頁)、onChange()、onWriter(是否可寫)
  var RETRY_MS = 3000;
  var MSG = {
    ro: "另一個分頁正在練習，請回那一頁。",
    nolock: "這個瀏覽器無法安全儲存練習紀錄（太舊或被限制），先不能練習；請更新 iPad／瀏覽器後再開。",
    lockfail: "這一頁拿不到存檔的權限（瀏覽器拒絕），無法安全儲存，先不能練習；請重新整理或換瀏覽器。",
    readfail: "讀不到原本紀錄，請再讀一次（原本的紀錄沒有動）。",
    badfile: "這台裝置上的錯題紀錄讀不懂（格式不對），為了不蓋掉原本的紀錄，先不能練習。請找爸媽處理。",
    migratefail: "舊版紀錄要換成新格式，但這台裝置現在存不進去；原本的紀錄沒有動，請再讀一次。",
    notready: "還沒讀到原本的紀錄，請先按「再讀一次」。",
    resetFail: "沒有清除成功：這台裝置現在存不了資料，紀錄維持原樣。",
    resetOk: "已清除全部作答紀錄。"
  };
  function createController(env) {
    var storage = env.storage || null, locks = env.locks || null, items = env.items || [];
    var now = env.now || function () { return Date.now(); };
    var setT = env.setTimeout || function (f, ms) { return setTimeout(f, ms); };
    var clrT = env.clearTimeout || function (i) { clearTimeout(i); };
    var post = env.post || function () {}, onChange = env.onChange || function () {}, onWriter = env.onWriter || function () {};
    var S = { mode: "BOOT", writer: false, ready: false, dirty: false, touched: false, st: blank(), sess: null, gen: 0, retry: null, release: null, waiting: false };
    var byId = {}; items.forEach(function (it) { byId[it.id] = it; });

    function emit() { try { onChange(); } catch (e) {} }
    function no(reason) {
      var m = reason === "ro" ? MSG.ro : reason === "nolock" ? (S.mode === "LOCKFAIL" ? MSG.lockfail : MSG.nolock) : reason === "notready" ? MSG.notready : "";
      return { ok: false, reason: reason, msg: m };
    }
    // 寫入資格（每個修改入口都先過這裡）
    function gate(tok) {
      if (!S.writer) return no(S.mode === "NOLOCK" || S.mode === "LOCKFAIL" ? "nolock" : "ro");
      if (!S.ready) return no("notready");
      if (!tok || tok.gen !== S.gen) return no("stale");
      return null;
    }
    function curId() { var s = S.sess; return s && s.i < s.queue.length ? s.queue[s.i] : null; }
    function skipHidden() {
      var s = S.sess; if (!s || s.answered) return;
      while (s.i < s.queue.length && (isHidden(S.st, s.queue[s.i]) || !byId[s.queue[s.i]])) s.i++;
    }
    function arm() {
      if (S.retry !== null) return;
      S.retry = setT(function () { S.retry = null; if (S.dirty && S.writer && S.ready) { save(); emit(); } }, RETRY_MS);
    }
    function disarm() { if (S.retry !== null) { clrT(S.retry); S.retry = null; } }
    function save() {
      if (!S.writer || !S.ready) return false;
      try { storage.setItem(KEY, JSON.stringify(S.st)); }
      catch (e) { S.dirty = true; arm(); return false; }
      S.dirty = false; disarm(); return true;
    }
    // 讀存檔（只在取得寫入資格時、按「再讀一次」時）：成功才 READY
    function load() {
      S.ready = false; S.dirty = false; disarm();
      var raw;
      try { if (!storage) throw new Error("no storage"); raw = storage.getItem(KEY); } catch (e) { S.mode = "READFAIL"; return; }
      var d = decode(raw);
      if (!d.ok) { S.mode = "BADFILE"; S.st = blank(); return; }
      if (d.from === 1) {
        try { storage.setItem(KEY, JSON.stringify(d.st)); } catch (e) { S.mode = "MIGRATEFAIL"; return; }
      }
      S.st = d.st; S.ready = true; S.mode = "READY";
    }
    // 唯讀分頁：只為了顯示讀一下（不寫、不當工作狀態；接手時一定重讀）
    function loadView() {
      try { var d = storage ? decode(storage.getItem(KEY)) : { ok: false }; S.st = d.ok ? d.st : blank(); } catch (e) { S.st = blank(); }
    }
    function hold() {
      S.writer = true; S.waiting = false; S.sess = null; S.touched = false; S.gen++;
      load();
      emit(); try { onWriter(true); } catch (e) {}
      return new Promise(function (res) { S.release = res; });
    }
    function waitLock() {
      if (S.waiting) return;
      S.waiting = true;
      try { locks.request(LOCK, function () { return hold(); }).catch(function () { S.waiting = false; }); } catch (e) { S.waiting = false; }
    }
    function lockFail() { S.writer = false; S.ready = false; S.mode = "LOCKFAIL"; loadView(); emit(); }
    function boot() {
      if (!locks || typeof locks.request !== "function") { S.mode = "NOLOCK"; loadView(); emit(); return; }
      try {
        locks.request(LOCK, { ifAvailable: true }, function (lock) {
          if (!lock) { S.mode = "RO"; loadView(); emit(); waitLock(); return; }
          return hold();
        }).catch(lockFail);
      } catch (e) { lockFail(); }
    }
    // 主頁讓出：只在首頁、沒有未存進度時（練習中、DIRTY 都不讓）
    function yieldLock() {
      if (!S.writer || S.sess || S.dirty) return false;
      var r = S.release;
      S.writer = false; S.ready = false; S.mode = "RO"; S.release = null; S.gen++; disarm();
      try { onWriter(false); } catch (e) {}
      loadView(); emit();
      if (r) r();
      waitLock();
      return true;
    }
    function message(m) {
      if (m === "want") { if (S.writer && !yieldLock()) post("busy"); }
      else if (m === "busy" && !S.writer) { S.busy = true; emit(); }
    }
    function askTakeover() { if (S.writer || !locks) return false; S.busy = false; post("want"); return true; }
    function refreshView() { if (!S.writer) { loadView(); emit(); } }

    function token() { return { gen: S.gen, qid: curId() }; }
    function start(tok, list, label) {
      var g = gate(tok); if (g) return g;
      if (!list.length) return { ok: false, reason: "empty", msg: "" };
      S.sess = { label: label, queue: list.map(function (it) { return it.id; }), i: 0, right: 0, wrong: 0, requeued: {}, answered: false, last: null, mastered: 0 };
      skipHidden(); S.gen++; emit();
      return { ok: true };
    }
    function startToday(tok) { return start(tok, dueList(visible(items, S.st), S.st, dayKey(now())), "今天的複習"); }
    function startExam(tok, subject) { return start(tok, examList(visible(items, S.st), S.st, subject), (subject || "全部科目") + "考前總複習"); }
    function answer(tok, val) {
      var g = gate(tok); if (g) return g;
      var s = S.sess, id = curId();
      if (!s || !id || tok.qid !== id) return no("stale");
      if (s.answered) return no("answered");
      if (isHidden(S.st, id) || !byId[id]) return no("hidden");
      var it = byId[id], ok = isRight(it, val), wasM = !!(S.st.it[id] || {}).m;
      var r = record(S.st, id, ok, dayKey(now()));
      S.st = r.state; S.touched = true;
      s.answered = true; s.last = { val: val, ok: ok, counted: r.counted };
      if (ok) { s.right++; if (!wasM && S.st.it[id].m) s.mastered++; }
      else { s.wrong++; if (!s.requeued[id]) { s.requeued[id] = 1; s.queue.push(id); } }
      S.gen++;
      var saved = save();
      emit();
      return { ok: true, right: ok, counted: r.counted, saved: saved, chime: ok && S.st.settings.sound !== false };
    }
    function next(tok) {
      var g = gate(tok); if (g) return g;
      var s = S.sess; if (!s || !s.answered || tok.qid !== curId()) return no("stale");
      s.i++; s.answered = false; s.last = null; skipHidden(); S.gen++; emit();
      return { ok: true };
    }
    function home(tok) {
      var g = gate(tok); if (g) return g;
      S.sess = null; S.gen++; emit();
      return { ok: true };
    }
    function setHiddenOp(tok, id, on) {
      var g = gate(tok); if (g) return g;
      if (!ID.test(String(id))) return no("stale");
      S.st = setHidden(S.st, id, !!on); S.touched = true;
      skipHidden(); S.gen++;
      var saved = save(); emit();
      return { ok: true, saved: saved };
    }
    function setSound(tok, sound, tone) {
      var g = gate(tok); if (g) return g;
      var t = Number.isInteger(tone) && tone >= 0 && tone < 10 ? tone : S.st.settings.tone;
      S.st = copy(S.st); S.st.settings = { sound: !!sound, tone: t }; S.touched = true;
      var saved = save(); emit();
      return { ok: true, saved: saved };
    }
    function reset(tok) {
      var g = gate(tok); if (g) return g;
      var cand = resetProgress(S.st);
      try { storage.setItem(KEY, JSON.stringify(cand)); }
      catch (e) { emit(); return { ok: false, reason: "save", msg: MSG.resetFail }; }
      S.st = cand; S.dirty = false; disarm(); S.sess = null; S.touched = true; S.gen++; emit();
      return { ok: true, msg: MSG.resetOk };
    }
    function retrySave() {
      if (!S.writer || !S.ready || !S.dirty) return false;
      var ok = save(); emit(); return ok;
    }
    function reread() {
      if (!S.writer) return no(S.mode === "NOLOCK" || S.mode === "LOCKFAIL" ? "nolock" : "ro");
      if (S.ready) return { ok: false, reason: "ready", msg: "" };   // 已經讀成功：舊的「再讀一次」重播不能把記憶體換回磁碟版
      load(); S.sess = null; S.gen++; emit();
      return S.ready ? { ok: true } : { ok: false, reason: "notready", msg: viewMsg() };
    }
    // 同步（g5-help/sync.js 的 canReplace／accept）：只有主頁、首頁、沒有未存進度、本頁載入後還沒有自己的修改時，才接受雲端整份換上。
    // 寫進主 key 成功才採用；只接受合法 v2（壞的、舊版 v1 都不接，等那台更新後上傳 v2）。
    function canReplace(key) { return key === KEY && S.writer && S.ready && !S.sess && !S.dirty && !S.touched; }
    function accept(key, raw) {
      if (!canReplace(key) || typeof raw !== "string") return false;
      var d = decode(raw); if (!d.ok || d.from !== 2) return false;
      try { storage.setItem(KEY, raw); } catch (e) { return false; }
      S.st = d.st; S.gen++; emit();
      var back; try { back = storage.getItem(KEY); } catch (e) { back = null; }
      return back === raw;
    }
    function viewMsg() {
      return { RO: MSG.ro, NOLOCK: MSG.nolock, LOCKFAIL: MSG.lockfail, READFAIL: MSG.readfail, BADFILE: MSG.badfile, MIGRATEFAIL: MSG.migratefail }[S.mode] || "";
    }
    function view() {
      return { mode: S.mode, writer: S.writer, ready: S.ready, dirty: S.dirty, busy: !!S.busy, gen: S.gen, msg: viewMsg(),
        st: copy(S.st), sess: S.sess ? copy(S.sess) : null };
    }
    return {
      boot: boot, view: view, token: token, startToday: startToday, startExam: startExam, answer: answer, next: next, home: home,
      setHidden: setHiddenOp, setSound: setSound, reset: reset, retrySave: retrySave, reread: reread,
      askTakeover: askTakeover, message: message, yieldLock: yieldLock, refreshView: refreshView, canReplace: canReplace, accept: accept,
      mode: function () { return S.mode; }
    };
  }

  var api = {
    SUBJECTS: SUBJECTS, TYPES: TYPES, MASTER: MASTER, GAP: GAP, KEEP: KEEP, LOG_MAX: LOG_MAX,
    dayKey: dayKey, addDays: addDays, isDay: isDay, itemProblems: itemProblems, norm: norm, isRight: isRight, answerText: answerText,
    KEY: KEY, LOCK: LOCK, V: V, MSG: MSG, RETRY_MS: RETRY_MS,
    blank: blank, decode: decode, visible: visible, isHidden: isHidden, setHidden: setHidden, resetProgress: resetProgress, record: record, createController: createController, dueList: dueList, examList: examList, stats: stats, status: status
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.G5WrongCore = api;
})(typeof window !== "undefined" ? window : this);
