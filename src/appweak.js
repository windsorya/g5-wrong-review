// 各科 app 待加強入口（交辦 #3016，設計書 docs/app-weak-entry-design-20261019.md）。純函式，node 測試與網頁共用同一份。
// 由來：律師要錯題站也涵蓋孩子在自然、數學、國語、社會站練習答錯的題，目標是 11/5–11/6 期中考考高分。
// 不變量（設計書第 0 節）：
//   I1 一張卡的作答紀錄與「待加強」判定只在該科站；這裡只讀、不寫四個科目 key，也不存任何科目卡的紀錄。
//   I2 停出名單（out／challenge）只有一份在各科站；這裡不抄名單、不抄 weakCard，題數一律由該科站的 weak-export.js 算。
//   I3 量不到就說量不到，不顯示 0：數字只來自「讀到紀錄、該科函式算出」的結果。
//   I5 本機、雲端兩份紀錄只「選一份來看」，不合併。
(function (root) {
  "use strict";
  var BASE = "https://windsorya.github.io/";
  // 順序同切換列（自然、數學、國語、社會）；key 同各科站與家庭同步白名單（g5-help/gas/core.js KEYS）
  var SUBJECTS = [
    { key: "g5sci.v3", name: "自然", site: "g5-sci-review" },
    { key: "g5math.v2", name: "數學", site: "g5-math-review" },
    { key: "g5chi.v1", name: "國語", site: "g5-chinese-review" },
    { key: "g5soc.v1", name: "社會", site: "g5-social-review" }
  ];
  SUBJECTS.forEach(function (s) { s.home = BASE + s.site + "/"; s.exportUrl = s.home + "weak-export.js"; });
  var API = 1;
  var FIELDS = ["answers", "seen", "weak", "weakToday", "challenge", "challengeToday", "out"];
  // 錯題站自己的全域：科目站的 export 檔不得換掉（換掉＝格式不對，網頁換回原物件）
  var OWN_GLOBALS = ["G5WrongCore", "G5WrongApp", "G5Tones", "G5Sync", "G5WrongBank", "G5AppWeak", "G5WeakExportRegister"];

  function isObj(x) { return !!x && typeof x === "object" && !Array.isArray(x); }
  function nat(x) { return typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= 9007199254740991; }

  // 科目站提供的介面（設計書第 2 節）
  function okExport(x, key) {
    return isObj(x) && x.api === API && x.key === key && typeof x.summarize === "function";
  }
  function okSummary(s) {
    if (!isObj(s) || s.ok !== true) return false;
    if (!FIELDS.every(function (f) { return nat(s[f]); })) return false;
    return s.weakToday <= s.weak && s.challengeToday <= s.challenge;
  }
  // links 只接受該站自己的網址（不讓別站的檔把孩子帶到別處）。
  // 比對的是瀏覽器正規化後的網址（../、%2e%2e 會被解開），回傳正規化後那一個——畫面標「自然」就真的去自然站。
  function okLink(u, subj) {
    if (typeof u !== "string" || u.length >= 300 || /[\s"'<>\\]/.test(u) || u.indexOf(subj.home) !== 0) return null;
    var h;
    try { h = new URL(u).href; } catch (e) { return null; }
    return h.indexOf(subj.home) === 0 ? h : null;
  }
  function links(exp, subj) {
    try {
      var l = isObj(exp) && isObj(exp.links) ? exp.links : {};
      return { weak: okLink(l.weak, subj), challenge: okLink(l.challenge, subj) };
    } catch (e) { return { weak: null, challenge: null }; }
  }
  // 家庭同步 get 回應（g5-help/gas/core.js handle()：rev 0＝雲端沒有這科，data 與 updated 都是 null）
  function okCloud(r) {
    if (!isObj(r) || r.ok !== true || !nat(r.rev)) return false;
    if (r.rev === 0) return r.data === null && r.updated === null;
    return typeof r.data === "string" && nat(r.updated);
  }
  // 用該科站的函式讀一份紀錄：丟例外或回傳 {ok:false}＝讀不懂（null）；
  // 回傳的東西本身不合介面（ok:true 但欄位不對、不是物件…）＝科目站給的格式不對（"format"，設計書第 2 節）
  function summarize(exp, raw, now) {
    var s;
    try { s = exp.summarize(raw, now); } catch (e) { return null; }
    var out = {};
    try {   // 回傳物件的欄位可能是丟例外的 getter：一律當格式不對，不讓它弄壞整頁（Codex 設計者 M23）
      if (isObj(s) && s.ok === false) return null;
      if (!okSummary(s)) return "format";
      FIELDS.forEach(function (f) { out[f] = s[f]; });
    } catch (e) { return "format"; }
    return out;
  }
  // 要讀的紀錄（本機一份、雲端不同於本機時再一份）；resolve 用
  function candidates(local, cloud) {
    local = local || { raw: null };
    var localRaw = !local.err && typeof local.raw === "string" ? local.raw : null;
    var cloudRaw = isObj(cloud) && typeof cloud.data === "string" ? cloud.data : null;
    var cands = [];
    if (localRaw !== null) cands.push({ from: "local", raw: localRaw });
    if (cloudRaw !== null && cloudRaw !== localRaw) cands.push({ from: "cloud", raw: cloudRaw, updated: cloud.updated });
    return cands;
  }
  function more(a, b) { return a.answers !== b.answers ? a.answers > b.answers : a.seen > b.seen; }

  // 一科的結果。src：
  //   exp：undefined＝檔案載入中；null＝沒有這個檔或載不到；"bad"＝載到但介面不符；物件＝介面合格
  //   local：{raw: 字串|null} 或 {err:true}（storage 讀取丟例外）
  //   cloud："nocode"（這台沒有家庭碼）、"pending"（讀取中）、"fail"（請求失敗或回應不合格）、或 {rev, data, updated}
  //   auto：這台的同步碼是自動建立、還沒跟家人連上（g5sync.auto）
  // 回傳 {key, name, home, state:"loading"|"ok"|"na", why, sum, from:"local"|"cloud", updated, cloudNote, links}
  function resolve(subj, src, now) {
    var r = { key: subj.key, name: subj.name, home: subj.home, state: "na", kind: "unreachable", why: "", sum: null, from: null, updated: null, cloudNote: "", links: { weak: null, challenge: null } };
    var exp = src.exp, local = src.local || { raw: null }, cloud = src.cloud;
    if (exp === undefined) { r.state = "loading"; r.why = "讀取中…"; return r; }
    if (exp === null) { r.why = "量不到：" + subj.name + "站還沒提供待加強題數（或現在連不上網路）"; return r; }
    var good = false;
    try { good = okExport(exp, subj.key); if (good) r.links = links(exp, subj); } catch (e) { good = false; }
    if (!good) { r.kind = "format"; r.why = "量不到：" + subj.name + "站提供的題數資料格式不對"; return r; }
    r.kind = "unmeasured";
    var cands = candidates(local, cloud);
    var best = null, format = false;
    cands.forEach(function (c) {
      var s = summarize(exp, c.raw, now);
      if (s === "format") { format = true; return; }
      if (!s) return;
      if (!best || more(s, best.sum)) best = { from: c.from, sum: s, updated: c.updated || null };
    });
    if (best) {
      r.state = "ok"; r.sum = best.sum; r.from = best.from; r.updated = best.from === "cloud" ? best.updated : null;
      if (best.from === "local") r.cloudNote = cloud === "fail" ? "雲端暫時讀不到，可能不是最新" : cloud === "pending" ? "雲端讀取中" : "";
      return r;
    }
    if (cloud === "pending") { r.state = "loading"; r.why = "讀取中…"; return r; }   // 本機讀不懂但雲端還在讀：等雲端
    if (format) { r.kind = "format"; r.why = "量不到：" + subj.name + "站提供的題數資料格式不對"; return r; }
    if (cands.length) { r.why = "量不到：" + subj.name + "站的紀錄讀不懂"; return r; }
    var here = local.err ? "這台裝置的紀錄讀不到" : "這台裝置沒有" + subj.name + "站的紀錄";
    if (cloud === "nocode") r.why = "量不到：" + here + "，也還沒開跨裝置同步";
    else if (isObj(cloud) && cloud.rev === 0) r.why = "量不到：" + (local.err ? here + "，雲端也" : "這台和雲端都") + "還沒有" + subj.name + "站的紀錄" +
      (src.auto ? "（這台的同步還沒跟家裡其他裝置連上，請到下面「跨裝置同步」貼家裡的連結）" : "");
    else r.why = "量不到：" + here + "，雲端暫時讀不到（可能沒有網路）";
    return r;
  }

  // ── 一科可能有好幾次 export 載入（逾時後重試、手動重新讀取）。Codex 設計者（/tmp/cc3016_designer_out.md）根因：
  // 「可不可用」＝resolve(export, 本機紀錄, 雲端紀錄, now)，不是 export 自己的屬性；舊做法在載入當下判一次就丟掉別的 export，
  // 紀錄一變就無法挽回。現在：每次載入都留下事實（attempt），畫面每次 render 用同一份紀錄與時間逐一 resolve，再選一列。
  // attempt：{id: 發出順序, st: "pending"|"timeout"|"error"|"bad"|"cand", exp: 介面合格的快照（st=cand 才有）}
  //   pending＝還在載、沒逾時；timeout＝逾時沒回（晚到仍會改成 cand／bad／error）；error＝載不到；bad＝介面不合格或沒註冊
  // 優先序（同級取 id 最大＝最晚發出的那次）：ok ＞ 讀取中 ＞ 介面合格但紀錄量不到 ＞ 格式不對 ＞ export 載不到
  var TIER = { ok: 5, loading: 4, unmeasured: 3, format: 2, unreachable: 1 };
  var AS_EXP = { timeout: null, error: null, bad: "bad" };
  function tier(r) { return r.state === "ok" ? TIER.ok : r.state === "loading" ? TIER.loading : TIER[r.kind] || TIER.unreachable; }
  function pick(subj, attempts, base, now) {
    var best = null, bestT = 0, bestId = -1;
    (attempts && attempts.length ? attempts : [{ id: 0, st: "pending" }]).forEach(function (a) {
      var exp = a.st === "cand" ? a.exp : a.st === "pending" ? undefined : AS_EXP[a.st] !== undefined ? AS_EXP[a.st] : null;
      var r = resolve(subj, { exp: exp, local: base.local, cloud: base.cloud, auto: base.auto }, now), t = tier(r);
      if (t > bestT || (t === bestT && a.id > bestId)) { best = r; bestT = t; bestId = a.id; }
    });
    best.attempt = bestId;
    return best;
  }
  // 還有一次 export 在載、沒逾時：這時按重新讀取不再發新的（M10）
  function exportPending(attempts) { return (attempts || []).some(function (a) { return a.st === "pending"; }); }
  // 按「重新讀取」要不要重載這科的 export：畫面這科不是 ok、且沒有載入中的（設計者第 3 節；「沒有紀錄」也會重載，明確成本、不自動重試）
  function wantReload(row, attempts) { return row.state !== "ok" && !exportPending(attempts); }
  // 載入當下把 export 拍成快照：之後科目站的檔改了原物件的 summarize／links 也不影響已存的候選（M23）。不合格回 null。
  function snapshot(reg, subj) {
    try {
      if (!okExport(reg, subj.key)) return null;
      var fn = reg.summarize, l = links(reg, subj), snap = { api: reg.api, key: reg.key, links: { weak: l.weak, challenge: l.challenge } };
      snap.summarize = function (raw, now) { return fn.call(snap, raw, now); };
      return snap;
    } catch (e) { return null; }
  }

  // 整區的顯示模型：總數只加有數字的科目、只加範圍內的 weak（不加 challenge、不加 out）
  function panel(rows) {
    var total = 0, measured = 0, na = [], loading = 0, challenge = [];
    rows.forEach(function (r) {
      if (r.state === "ok") { measured++; total += r.sum.weak; if (r.sum.challenge > 0) challenge.push(r); }
      else if (r.state === "loading") loading++;
      else na.push(r.name);
    });
    return { total: total, measured: measured, na: na, loading: loading, challenge: challenge };
  }
  // 一科的狀態句（只有 state ok 才有數字）
  function rowText(r) {
    if (r.state !== "ok") return r.why;
    var s = r.sum;
    if (!s.weak) return "沒有待加強的題";
    if (s.weakToday === s.weak) return "待加強 " + s.weak + " 題";
    if (!s.weakToday) return "待加強 " + s.weak + " 題（今天都練過了，明天再練）";
    return "待加強 " + s.weak + " 題（今天可以練 " + s.weakToday + " 題，其餘今天練過了）";
  }
  function challengeText(r) {
    var s = r.sum;
    if (s.challengeToday === s.challenge) return s.challenge + " 題";
    if (!s.challengeToday) return s.challenge + " 題（今天都練過了，明天再練）";
    return s.challenge + " 題（今天可以練 " + s.challengeToday + " 題）";
  }
  function pad(n) { return ("0" + n).slice(-2); }
  function taipei(ms) {
    var d = new Date(ms + 8 * 3600000);
    return (d.getUTCMonth() + 1) + "/" + d.getUTCDate() + " " + pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes());
  }
  function sourceText(r) {
    if (r.state !== "ok") return "";
    if (r.from === "cloud") return "依雲端紀錄（" + taipei(r.updated) + " 上傳）";
    return "依這台裝置的紀錄" + (r.cloudNote ? "（" + r.cloudNote + "）" : "");
  }

  var api = {
    SUBJECTS: SUBJECTS, API: API, FIELDS: FIELDS, OWN_GLOBALS: OWN_GLOBALS,
    okExport: okExport, okSummary: okSummary, okCloud: okCloud, links: links, summarize: summarize,
    pick: pick, exportPending: exportPending, wantReload: wantReload, snapshot: snapshot, TIER: TIER,
    resolve: resolve, panel: panel, rowText: rowText, challengeText: challengeText, sourceText: sourceText, taipei: taipei
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.G5AppWeak = api;
})(typeof window !== "undefined" ? window : this);
