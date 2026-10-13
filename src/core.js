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
    if (!s(it.id) || !/^[\w-]{1,60}$/.test(it.id)) bad.push("id 不合法");
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
  // 資料模型（Codex 審 151f6f09、cf61e0ff 連兩輪抓到多分頁／存檔失敗的覆蓋問題後改）：
  //   紀錄不是「整份誰最後寫誰贏」，而是逐題合併——每題作答紀錄 it[id].t、每個隱藏設定 hidden[id] 都帶修改時間（毫秒），
  //   清除＝記一個 resetAt（之前的作答紀錄一律作廢）。merge(甲, 乙) 逐題取較新的那筆，所以：
  //   ・兩個分頁各寫各的題，不會互相蓋掉；・存不進去時記憶體裡的進度不會被重讀蓋掉，下次存得進去就一起存；
  //   ・別頁清除後，這頁舊的紀錄比 resetAt 舊，合併時自動丟掉，不會復活。
  //   hidden[id]：正數＝那個時間設成不用再練；負數＝那個時間恢復（留著是為了合併時比得出誰新）；舊版的 true 視為很早以前隱藏。
  function blank() { return { v: 1, it: {}, hidden: {}, resetAt: 0, settings: { sound: true, tone: 0 } }; }
  function isHidden(state, id) { var h = (state && state.hidden) || {}; return h[id] === true || (typeof h[id] === "number" && h[id] > 0); }
  function visible(items, state) { return items.filter(function (it) { return !isHidden(state, it.id); }); }
  function setHidden(state, id, on, now) {
    var st = JSON.parse(JSON.stringify(state)), t = Math.max(1, now || Date.now());
    st.hidden = st.hidden || {};
    st.hidden[id] = on ? t : -t;
    return st;
  }
  // 清除全部作答紀錄：進度歸零，保留提示音設定與「不用再練」名單（那是爸媽的選擇，不是作答紀錄）
  function resetProgress(state, now) {
    var st = blank();
    st.settings = JSON.parse(JSON.stringify(state.settings)); st.hidden = JSON.parse(JSON.stringify(state.hidden || {}));
    st.resetAt = Math.max(state.resetAt || 0, now || Date.now());
    return st;
  }
  // 逐題合併：base＝存檔裡讀到的、mine＝這個分頁記憶體裡的；設定以 mine 為準（是這頁剛改的）
  function merge(base, mine) {
    var st = blank(), ids = {};
    st.settings = JSON.parse(JSON.stringify(mine.settings));
    st.resetAt = Math.max(base.resetAt || 0, mine.resetAt || 0);
    Object.keys(base.it).concat(Object.keys(mine.it)).forEach(function (id) { ids[id] = 1; });
    Object.keys(ids).forEach(function (id) {
      var a = base.it[id], b = mine.it[id], w = !a ? b : !b ? a : ((b.t || 0) >= (a.t || 0) ? b : a);
      if ((w.t || 0) >= st.resetAt) st.it[id] = JSON.parse(JSON.stringify(w));
    });
    var hv = function (x) { return x === true ? 1 : typeof x === "number" ? x : 0; };
    Object.keys(base.hidden || {}).concat(Object.keys(mine.hidden || {})).forEach(function (id) {
      var a = hv((base.hidden || {})[id]), b = hv((mine.hidden || {})[id]);
      st.hidden[id] = Math.abs(b) >= Math.abs(a) ? b : a;
    });
    return st;
  }
  // 讀進來的紀錄一律重新整理：壞掉的欄位丟掉，不讓一筆壞資料弄壞整頁
  function clean(raw) {
    var st = blank();
    if (!raw || typeof raw !== "object" || raw.v !== 1) return st;
    if (raw.settings && typeof raw.settings === "object") {
      st.settings.sound = raw.settings.sound !== false;
      st.settings.tone = Number.isInteger(raw.settings.tone) && raw.settings.tone >= 0 && raw.settings.tone < 10 ? raw.settings.tone : 0;
    }
    if (raw.hidden && typeof raw.hidden === "object") {
      Object.keys(raw.hidden).forEach(function (id) {
        var x = raw.hidden[id];
        if (!/^[\w-]{1,60}$/.test(id)) return;
        if (x === true) st.hidden[id] = 1;   // 舊版格式
        else if (typeof x === "number" && Number.isFinite(x) && x !== 0) st.hidden[id] = x;
      });
    }
    st.resetAt = Number.isInteger(raw.resetAt) && raw.resetAt > 0 ? raw.resetAt : 0;
    var src = raw.it && typeof raw.it === "object" ? raw.it : {};
    Object.keys(src).forEach(function (id) {
      var e = src[id];
      if (!/^[\w-]{1,60}$/.test(id) || !e || typeof e !== "object") return;
      var n = function (x) { return Number.isInteger(x) && x >= 0 ? x : 0; };
      st.it[id] = {
        n: n(e.n), ok: n(e.ok), bad: n(e.bad), s: Math.min(n(e.s), MASTER), m: e.m === true,
        last: isDay(e.last) ? e.last : "", due: isDay(e.due) ? e.due : "", t: n(e.t),
        log: Array.isArray(e.log) ? e.log.filter(function (l) { return Array.isArray(l) && isDay(l[0]) && (l[1] === 0 || l[1] === 1); }).slice(-LOG_MAX) : []
      };
    });
    return st;
  }

  // 記一次作答。回傳新的 state（不改舊的），以及這次有沒有算進進度（counted）。
  function record(state, id, right, today, now) {
    var st = JSON.parse(JSON.stringify(state)), e = st.it[id] || { n: 0, ok: 0, bad: 0, s: 0, m: false, last: "", due: "", log: [], t: 0 };
    e.t = Math.max((e.t || 0) + 1, now || Date.now(), st.resetAt || 0);   // 修改時間（逐題合併用），一定比舊的新、不早於清除時間
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

  var api = {
    SUBJECTS: SUBJECTS, TYPES: TYPES, MASTER: MASTER, GAP: GAP, KEEP: KEEP, LOG_MAX: LOG_MAX,
    dayKey: dayKey, addDays: addDays, isDay: isDay, itemProblems: itemProblems, norm: norm, isRight: isRight, answerText: answerText,
    blank: blank, clean: clean, visible: visible, isHidden: isHidden, setHidden: setHidden, resetProgress: resetProgress, merge: merge, record: record, dueList: dueList, examList: examList, stats: stats, status: status
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.G5WrongCore = api;
})(typeof window !== "undefined" ? window : this);
