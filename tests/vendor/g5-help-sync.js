/* ES5 syntax; requires native Promise/fetch (or the supplied fetch function).
 * Progress documents are opaque strings. No field-level merging is performed.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  if (root) { root.G5Sync = api; }
}(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function (root) {
  'use strict';
  var ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  var KEYS = ['g5sci.v3', 'g5help.v1', 'g5math.v1', 'g5math.v2', 'g5chi.v1', 'g5soc.v1', 'g5wrong.v1'];   // g5wrong：錯題複習站（2026-10-13）   // g5chi／g5soc：五上國語、社會站（GAS 白名單 f53bd54／@7）
  var CODE = 'g5sync.code';
  var META = 'g5sync.meta';
  var BAD_CODE = '同步碼須為 12 碼英文字母或數字，不含 0、O、1、I、L；可包含空白與連字號。';
  var K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  function rotate(x, n) { return (x >>> n) | (x << (32 - n)); }
  // SHA-256 over tagged UTF-16LE, including lone surrogates without lossy coercion.
  function contentHash(value) {
    var s = value === null ? 'N' : 'S' + value;
    var bytes = s.length * 2;
    var size = Math.ceil((bytes + 9) / 64) * 64;
    var h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    var bits = bytes * 8;
    var w = new Array(64);
    var offset, i, j, p, b;
    for (offset = 0; offset < size; offset += 64) {
      for (i = 0; i < 16; i += 1) {
        w[i] = 0;
        for (j = 0; j < 4; j += 1) {
          p = offset + i * 4 + j;
          b = 0;
          if (p < bytes) { b = (s.charCodeAt(Math.floor(p / 2)) >>> ((p % 2) * 8)) & 255; }
          else if (p === bytes) { b = 128; }
          else if (p >= size - 4) { b = (bits >>> ((size - 1 - p) * 8)) & 255; }
          else if (p >= size - 8) { b = (Math.floor(bits / 4294967296) >>> ((size - 5 - p) * 8)) & 255; }
          w[i] = (w[i] << 8) | b;
        }
      }
      for (i = 16; i < 64; i += 1) {
        var s0 = rotate(w[i - 15], 7) ^ rotate(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        var s1 = rotate(w[i - 2], 17) ^ rotate(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      var a = h[0], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], z = h[7];
      b = h[1];
      for (i = 0; i < 64; i += 1) {
        var t1 = (z + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
        var t2 = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        z = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      var work = [a,b,c,d,e,f,g,z];
      for (i = 0; i < 8; i += 1) { h[i] = (h[i] + work[i]) | 0; }
    }
    return 'sha256-utf16le:' + h.map(function (n) { return ('00000000' + (n >>> 0).toString(16)).slice(-8); }).join('');
  }
  function normalizeCode(value) {
    var code = String(value || '').replace(/[\s-]/g, '').toUpperCase();
    return code.length === 12 && /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]+$/.test(code) ? code : null;
  }
  function error(kind) { var e = new Error(kind); e.kind = kind; return e; }
  function integer(n) { return typeof n === 'number' && isFinite(n) && Math.floor(n) === n && n >= 0 && n < 9007199254740991; }
  function pad(n) { return ('0' + n).slice(-2); }
  function taipei(stamp, full) {
    if (!integer(stamp)) { return '尚無紀錄'; }
    // Asia/Taipei is UTC+08:00 for every timestamp produced by this app.
    var d = new Date(stamp + 8 * 3600000);
    var time = pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
    return full ? d.getUTCFullYear() + '/' + pad(d.getUTCMonth() + 1) + '/' + pad(d.getUTCDate()) + ' ' + time + '（台北時間）' : time;
  }

  function init(options) {
    options = options || {};
    var container = options.container;
    var doc = (container && container.ownerDocument) || root.document;
    if (typeof container === 'string' && doc) { container = doc.querySelector(container); }
    if (!container || !doc) { throw new Error('G5Sync requires a container'); }
    var keys = (options.keys || KEYS).filter(function (key, i, all) { return all.indexOf(key) === i; });
    if (!keys.length || keys.some(function (key) { return KEYS.indexOf(key) < 0; })) { throw new Error('G5Sync: bad-key'); }
    var now = options.now || Date.now;
    var fetcher = options.fetch || (root.fetch && root.fetch.bind(root));
    var storage;
    try { storage = options.storage || root.localStorage; } catch (ignoreStorage) { storage = null; }
    var code = null, epoch = 0, destroyed = false, stopped = false;
    var busy = null, activeAbort = null, retryTimer = null, failures = 0, retryAt = 0;
    var needsGet = {}, conflicts = {}, decisions = {}, observed = {}, replaced = [], deferred = {};
    var status = '尚未開啟同步', notice = '', viewCode, view = {};
    // 頁面自己是唯一寫入者（提供 accept，難題站）：#1303 第 7 輪後依升級階梯縮範圍——關閉「留這台／留雲端」衝突選擇，
    // 兩台不一樣就各自保留（這台用這台的、雲端那份不動），不出按鈕、resolve 拒絕。自然站（沒有 accept）照舊。
    var pageOwned = typeof options.accept === 'function';
    var KEPT = '兩台裝置的紀錄不一樣：這台照常用這台的，雲端那份不動（各自保留，不會互相蓋掉）。';
    var UNSURE = '雲端的紀錄跟這台送出的對不上，無法確認是哪一台寫的：這台照常用這台的，雲端那份不動（各自保留）。';
    var JOURNAL = '這台的同步紀錄讀不懂，為了不蓋掉任何一邊，先暫停上傳；進度都還在這台（停止同步後重新加入可恢復）。';
    // 設計 D・A1（Codex 設計者，#1347 第 4 輪起）：有 accept 的頁面，每個 key 只有一筆「待確認上傳」，送出前就存好。
    // checkpoint（g5sync.ckpt.<key>，本站自己的 namespace，不改別站共用的 g5sync.meta）＝
    //   {version, codeHash, key, baseline: 已確認的 {rev, hash, updated} | null, pending: {baseRev, data, hash} | null}
    // baseline 與 pending 放在同一筆，一次 setItem 原子替換；寫完一定讀回核對，失敗就不送（A15）。
    // 回應遺失時不再猜「雲端是不是我送過的某一份」（舊版記憶體 sent 清單，重開頁就不見）——一律拿雲端跟 pending 比（recover）。
    var CKPT = 'g5sync.ckpt.';

    function read(key) {
      if (!storage) { throw error('storage'); }
      return storage.getItem(key);
    }
    function write(key, value) {
      if (!storage) { throw error('storage'); }
      storage.setItem(key, value);
    }
    function blankMeta() { return {version: 1, codeHash: contentHash(code), keys: {}}; }
    function readMeta() {
      var raw = read(META), meta;
      try { meta = JSON.parse(raw); } catch (ignore) { meta = null; }
      if (!meta || meta.version !== 1 || meta.codeHash !== contentHash(code) || !meta.keys || typeof meta.keys !== 'object' || Array.isArray(meta.keys)) { return blankMeta(); }
      return meta;
    }
    function validHash(h) { return typeof h === 'string' && /^sha256-utf16le:[a-f0-9]{64}$/.test(h); }
    function metaBaseline(key) {
      var entry = readMeta().keys[key];
      if (!entry || !integer(entry.rev) || !validHash(entry.hash)) { return null; }
      return entry;
    }
    // ---- checkpoint（只給有 accept 的頁面）----
    function blankCk(key) {
      var ck = {version: 1, codeHash: contentHash(code), key: key, baseline: null, pending: null};
      var old = metaBaseline(key);   // 舊版只有 g5sync.meta：只遷移已確認的 baseline，不編造 pending（A16）
      // legacy：這個 baseline 來自舊版（舊版送出時不留 pending）⇒ 之後雲端前進、本機也改了，無法證明是哪台寫的（A16，第 8 輪）
      if (old) { ck.baseline = {rev: old.rev, hash: old.hash, updated: integer(old.updated) ? old.updated : null, legacy: true}; }
      return ck;
    }
    function readCk(key) {
      var raw = read(CKPT + key), ck;
      if (raw === null) { return blankCk(key); }
      try { ck = JSON.parse(raw); } catch (ignore) { throw error('journal'); }
      if (!ck || typeof ck !== 'object' || ck.version !== 1 || ck.key !== key || typeof ck.codeHash !== 'string') { throw error('journal'); }
      if (ck.codeHash !== contentHash(code)) { return blankCk(key); }   // 別的家庭留下的：不沿用
      var b = ck.baseline, p = ck.pending;
      if (b !== null && !(b && integer(b.rev) && validHash(b.hash))) { throw error('journal'); }
      if (p !== null && !(p && integer(p.baseRev) && typeof p.data === 'string' && p.hash === contentHash(p.data) &&
          p.baseRev === (b ? b.rev : 0))) { throw error('journal'); }
      return ck;
    }
    function writeCk(key, ck) {
      if (ck.codeHash !== contentHash(code)) { throw error('stale'); }
      var raw = JSON.stringify(ck);
      write(CKPT + key, raw);
      if (read(CKPT + key) !== raw) { throw error('storage'); }   // 讀回不符＝沒存好（A10、A15）
    }
    function baseline(key) { return pageOwned ? readCk(key).baseline : metaBaseline(key); }
    // 已確認的 baseline 也照舊寫一份到 g5sync.meta 自己那一格（保留別站的格子）：只是相容鏡像（例如還開著舊版頁面的分頁讀 meta），
    // checkpoint 存在時一律以 checkpoint 為準；鏡像寫不進去不影響同步判斷。
    function mirrorMeta(key, b) {
      try { var meta = readMeta(); meta.keys[key] = {rev: b.rev, hash: b.hash, updated: b.updated}; write(META, JSON.stringify(meta)); }
      catch (ignoreMirror) { /* best effort */ }
    }
    function saveBaseline(key, rev, data, updated) {
      if (pageOwned) {
        var ck = readCk(key);
        if (ck.baseline && ck.baseline.rev > rev) { needsGet[key] = true; return; }
        ck.baseline = {rev: rev, hash: contentHash(data), updated: updated}; ck.pending = null;
        writeCk(key, ck); mirrorMeta(key, ck.baseline); return;
      }
      var meta = readMeta(); // Preserve other sites' key entries on the same origin.
      var previous = meta.keys[key];
      if (previous && integer(previous.rev) && previous.rev > rev) { needsGet[key] = true; return; }
      meta.keys[key] = {rev: rev, hash: contentHash(data), updated: updated};
      write(META, JSON.stringify(meta));
    }
    function active(token) {
      return !destroyed && !stopped && token === epoch && code && read(CODE) === code;
    }
    function assertActive(token) { if (!active(token)) { throw error('stale'); } }
    function observe(key, data) {
      var hash = contentHash(data);
      if (!observed[key] || observed[key].hash !== hash) { observed[key] = {hash: hash, detected: now()}; }
      return observed[key];
    }
    function backup(key, data) {
      if (data === null) { return; }
      var prefix = 'g5sync.backup.' + key + '.';
      var names = [];
      for (var i = 0; i < storage.length; i += 1) {
        var name = storage.key(i);
        if (name && name.indexOf(prefix) === 0 && /^\d+$/.test(name.slice(prefix.length))) { names.push(name); }
      }
      names.sort(function (a, b) { return Number(a.slice(prefix.length)) - Number(b.slice(prefix.length)); });
      var stamp = Math.max(now(), names.length ? Number(names[names.length - 1].slice(prefix.length)) + 1 : 0);
      // Write before pruning: quota errors must NEVER discard progress or its last backup.
      var target = prefix + stamp;
      write(target, data);
      if (read(target) !== data) { throw error('storage'); }
      names.push(target);
      while (names.length > 3) { storage.removeItem(names.shift()); }
    }
    function summary(key, data) {
      if (data === null) { return '沒有進度紀錄'; }
      try {
        if (options.summarize && typeof options.summarize[key] === 'function') { return String(options.summarize[key](data)); }
      } catch (ignore) { /* Summary errors cannot prevent reconciliation. */ }
      return '完整紀錄，共 ' + data.length + ' 字元';
    }
    function el(tag, className, text) {
      var node = doc.createElement(tag);
      node.className = 'g5s-' + className;
      if (typeof text !== 'undefined') { node.textContent = text; }
      return node;
    }
    function button(text, fn) {
      var b = el('button', 'button', text);
      b.type = 'button'; b.style.minHeight = '44px';
      b.addEventListener('click', fn);
      return b;
    }
    function link() {
      var href = root.location ? root.location.href : '';
      return href.split('#')[0] + '#sync=' + (code || '');
    }
    function clear(node) { while (node.firstChild) { node.removeChild(node.firstChild); } }
    function buildView() {
      clear(container);
      var panel = el('section', 'panel');
      panel.setAttribute('aria-label', '家庭跨裝置同步');
      view = {panel: panel};
      if (!code) {
        panel.appendChild(button('開啟跨裝置同步（這台是第一台）', function () { enable(); }));
        panel.appendChild(button('輸入同步碼（已在別台開過）', function () {
          view.join.hidden = false; view.input.focus();
        }));
        var form = el('form', 'join'); form.hidden = true;
        var label = el('label', 'label', '同步碼');
        var input = el('input', 'input'); input.type = 'text'; input.maxLength = 80;
        input.autocomplete = 'off'; input.spellcheck = false; input.style.minHeight = '44px';
        input.setAttribute('autocapitalize', 'characters'); input.setAttribute('aria-label', '同步碼');
        label.appendChild(input); form.appendChild(label);
        form.appendChild(el('p', 'hint', BAD_CODE));
        form.appendChild(button('加入同步', function () { join(input.value); }));
        form.addEventListener('submit', function (event) { event.preventDefault(); join(input.value); });
        panel.appendChild(form); view.join = form; view.input = input;
      } else {
        panel.appendChild(el('p', 'code', code.match(/.{4}/g).join('-')));
        var qrBox = el('div', 'qr');
        qrBox.setAttribute('aria-label', '掃描 QR code 加入同步');
        try {
          if (typeof root.qrcode !== 'function') { throw error('qr'); }
          var qr = root.qrcode(0, 'M'); qr.addData(link()); qr.make();
          qrBox.innerHTML = qr.createSvgTag({cellSize: 4, margin: 16, scalable: true});
          qrBox.style.maxWidth = '256px';
        } catch (qrError) { qrBox.textContent = 'QR code 無法顯示，請使用下方連結或同步碼。'; }
        panel.appendChild(qrBox);
        var share = el('input', 'link'); share.type = 'text'; share.readOnly = true;
        share.value = link(); share.setAttribute('aria-label', '同步連結'); share.style.minHeight = '44px';
        panel.appendChild(share);
        panel.appendChild(button('複製連結', function () {
          var clipboard = root.navigator && root.navigator.clipboard;
          if (clipboard && clipboard.writeText) {
            Promise.resolve().then(function () { return clipboard.writeText(link()); }).then(function () {
              notice = '連結已複製。'; render();
            }, function () { share.focus(); share.select(); notice = '請複製已選取的連結。'; render(); });
          } else { share.focus(); share.select(); notice = '請複製已選取的連結。'; render(); }
        }));
        panel.appendChild(button('這台停止同步', function () { stop(); }));
      }
      view.status = el('p', 'status'); view.status.setAttribute('role', 'status'); view.status.setAttribute('aria-live', 'polite');
      view.notice = el('p', 'notice'); view.notice.setAttribute('role', 'alert');
      view.conflicts = el('div', 'conflicts');
      panel.appendChild(view.status); panel.appendChild(view.notice); panel.appendChild(view.conflicts);
      container.appendChild(panel); viewCode = code;
    }
    function render() {
      if (destroyed) { return; }
      if (viewCode !== code || !view.panel) { buildView(); }
      view.status.textContent = status; view.notice.textContent = notice;
      var signature = keys.map(function (key) {
        if (!conflicts[key]) { return ''; }
        var local = read(key);
        return key + ':' + conflicts[key].rev + ':' + observe(key, local).hash + ':' + (decisions[key] || '') + (conflicts[key].unsure ? ':u' : '');
      }).join('|');
      if (view.signature === signature) { return; }
      view.signature = signature;
      clear(view.conflicts);
      keys.forEach(function (key) {
        var cloud = conflicts[key];
        if (!cloud) { return; }
        var local = read(key), obs = observe(key, local);
        var box = el('section', 'conflict');
        box.appendChild(el('h3', 'conflict-title', key + (pageOwned ? '：兩台的紀錄不一樣' : '：請選擇保留哪份完整紀錄')));
        box.appendChild(el('p', 'local-summary', '這台：' + summary(key, local)));
        box.appendChild(el('p', 'local-time', '本機變更偵測時間：' + taipei(obs.detected, true) + '；實際作答時間由各站紀錄提供。'));
        box.appendChild(el('p', 'cloud-summary', '雲端：' + summary(key, cloud.data)));
        box.appendChild(el('p', 'cloud-time', '雲端更新時間：' + taipei(cloud.updated, true)));
        if (pageOwned) { box.appendChild(el('p', 'kept', cloud.unsure ? UNSURE : KEPT)); view.conflicts.appendChild(box); return; }
        var keepLocal = button('留這台的', function () { resolve(key, 'local'); }); keepLocal.disabled = local === null || !!decisions[key];
        var keepCloud = button('留雲端的', function () { resolve(key, 'cloud'); }); keepCloud.disabled = cloud.data === null || !!decisions[key];
        box.appendChild(keepLocal); box.appendChild(keepCloud); view.conflicts.appendChild(box);
      });
    }
    function validSnapshot(r) {
      return r && integer(r.rev) && (r.rev === 0 ? r.data === null && r.updated === null :
        typeof r.data === 'string' && r.data.length <= 900000 && integer(r.updated));
    }
    function request(req, token) {
      assertActive(token);
      if (!options.endpoint || typeof fetcher !== 'function') { return Promise.reject(error('server')); }
      if (root.navigator && root.navigator.onLine === false) { return Promise.reject(error('offline')); }
      req.code = code;
      return new Promise(function (done, reject) {
        var settled = false;
        var controller = root.AbortController ? new root.AbortController() : null;
        activeAbort = controller;
        var timeout = root.setTimeout(function () {
          if (controller) { controller.abort(); }
          finish(error('offline'));
        }, 15000);
        function finish(err, value) {
          if (settled) { return; }
          settled = true; root.clearTimeout(timeout);
          if (activeAbort === controller) { activeAbort = null; }
          if (err) { reject(err); } else { done(value); }
        }
        var config = {method: 'POST', headers: {'Content-Type': 'text/plain'}, body: JSON.stringify(req),
          mode: 'cors', credentials: 'omit', redirect: 'follow', cache: 'no-store'};
        if (controller) { config.signal = controller.signal; }
        Promise.resolve().then(function () { return fetcher(options.endpoint, config); }).then(function (response) {
          assertActive(token);
          if (!response || response.ok === false || typeof response.json !== 'function') { throw error('server'); }
          return Promise.resolve().then(function () { return response.json(); }).catch(function () { throw error('server'); });
        }, function () { throw error('offline'); }).then(function (r) {
          assertActive(token);
          if (!r || (r.ok !== true && r.ok !== false)) { throw error('server'); }
          if (req.op === 'get' && r.ok !== true) { throw error('server'); }
          if (r.ok === false && r.err !== 'conflict') { throw error(r.err === 'too-big' ? 'too-big' : 'server'); }
          if ((req.op === 'get' || r.err === 'conflict') && !validSnapshot(r)) { throw error('server'); }
          if (req.op === 'put' && r.ok && (!integer(r.rev) || r.rev !== req.rev + 1 || !integer(r.updated))) { throw error('server'); }
          finish(null, r);
        }).catch(function (err) { finish(err); });
      });
    }
    function keptStatus() {
      return keys.some(function (key) { return conflicts[key] && conflicts[key].unsure; }) ? UNSURE : KEPT;
    }
    // unsure＝雲端版本對不上這台已確認／待確認的紀錄（倒退、跳號、同 rev 不同內容），無法確認是不是另一台寫的（只給有 accept 的頁面）
    function showConflict(key, cloud, unsure) {
      delete decisions[key]; // A newly observed cloud version requires a new choice.
      conflicts[key] = {rev: cloud.rev, data: cloud.data, updated: cloud.updated};
      if (pageOwned && unsure) { conflicts[key].unsure = true; }
      status = pageOwned ? keptStatus() : '有兩份進度，請選擇要保留的紀錄。';
      render();
    }
    function replaceLocal(key, cloud, token) {
      assertActive(token);
      if (cloud.data === null) { throw error('server'); }
      var currentMeta = baseline(key);
      if (currentMeta && currentMeta.rev > cloud.rev) { showConflict(key, cloud, true); return; }
      // 頁面自己是唯一寫入者時（難題站，#1303 第 5 輪）：先問能不能換（有未存進度、正在某一篇裡就不行），
      // 不行就什麼都不動（不備份、不寫），下一輪再 GET 再問；可以才備份，並交給頁面自己寫入與重畫（不 reload）。
      if (typeof options.canReplace === 'function' && !options.canReplace(key)) {
        needsGet[key] = true; deferred[key] = true; return;
      }
      var local = read(key);
      backup(key, local);
      assertActive(token);
      // Synchronous read/backup/write; no awaited work between decision and replacement.
      if (typeof options.accept === 'function') {
        if (!options.accept(key, cloud.data)) { needsGet[key] = true; deferred[key] = true; return; }
      } else { write(key, cloud.data); }
      if (read(key) !== cloud.data) { throw error('storage'); }
      delete deferred[key];
      replaced.push(key); // Notify even if persisting the following metadata fails.
      saveBaseline(key, cloud.rev, cloud.data, cloud.updated);
      delete conflicts[key];
    }
    function put(key, data, rev, token, chosenCloud) {
      if (data === null) { return Promise.resolve(); }
      if (data.length > 900000) { return Promise.reject(error('too-big')); }
      if (chosenCloud) { backup(key, chosenCloud.data); }
      return request({op: 'put', key: key, rev: rev, data: data}, token).then(function (r) {
        assertActive(token);
        if (r.err === 'conflict') { showConflict(key, r); return; }
        // The baseline is the exact request payload, never a newer local edit.
        saveBaseline(key, r.rev, data, r.updated);
        delete conflicts[key];
      });
    }
    // ---- 有 accept 的頁面：待確認上傳（設計 D・A1）----
    // 建立下一筆：先存進 checkpoint 並讀回，成功才送；確認舊 pending 之前不會呼叫這裡（pending 不會被新進度改寫）。
    function startPending(key, data, baseRev, token) {
      if (data.length > 900000) { return Promise.reject(error('too-big')); }
      var ck = readCk(key);
      if (ck.pending) { return sendPending(key, ck, token); }
      ck.pending = {baseRev: baseRev, data: data, hash: contentHash(data)};
      writeCk(key, ck);   // 寫入或讀回失敗就丟錯，不送 PUT（A15）
      assertActive(token);
      return sendPending(key, ck, token);
    }
    // 重送一律是同一份 baseRev＋payload（A01、A09、A13）
    function sendPending(key, ck, token) {
      var p = ck.pending;
      return request({op: 'put', key: key, rev: p.baseRev, data: p.data}, token).then(function (r) {
        assertActive(token);
        if (r.err === 'conflict') { return recover(key, r, token, true); }
        confirm(key, p, r.rev, r.updated);
      });
    }
    // 確認 pending 已提交：只認 checkpoint 裡現在那一筆；遲到或重複的回應不動 baseline、不倒退（A11）
    function confirm(key, p, rev, updated) {
      var ck = readCk(key);
      if (!ck.pending || ck.pending.hash !== p.hash || ck.pending.baseRev !== p.baseRev) { return; }
      if (rev !== p.baseRev + 1 || (ck.baseline && ck.baseline.rev >= rev)) { throw error('server'); }
      ck.baseline = {rev: rev, hash: p.hash, updated: updated}; ck.pending = null;
      writeCk(key, ck);   // 寫入／讀回失敗：pending 留著，下一輪再用雲端確認（A10）
      mirrorMeta(key, ck.baseline);
      delete conflicts[key];
    }
    // 確認完舊 pending 之後，才從本機最新資料建立下一筆（A02、A13）
    function nextFromLocal(key, token) {
      assertActive(token);
      var ck = readCk(key), local = read(key);
      if (!ck.pending && ck.baseline && local !== null && contentHash(local) !== ck.baseline.hash) { return startPending(key, local, ck.baseline.rev, token); }
    }
    // 首次啟用、重開頁（GET）、PUT 衝突都走這一個判斷（A03–A08）
    function recover(key, cloud, token, fromPut) {
      assertActive(token);
      var ck = readCk(key), local = read(key), b = ck.baseline, p = ck.pending;
      needsGet[key] = false;
      if (p) {
        var stillBase = cloud.rev === p.baseRev && (p.baseRev === 0 ? cloud.data === null : contentHash(cloud.data) === b.hash);
        if (stillBase) {   // 還沒提交：重送原 pending（PUT 被拒卻說雲端還在基準版本＝壞回應，不重送迴圈）
          if (fromPut) { throw error('server'); }
          return sendPending(key, ck, token);
        }
        if (cloud.rev === p.baseRev + 1 && cloud.data !== null && contentHash(cloud.data) === p.hash) {
          confirm(key, p, cloud.rev, cloud.updated);   // 雲端正是這份 pending、版本剛好下一號：自己的提交
          return nextFromLocal(key, token);
        }
        // 下一號是別的內容＝另一台寫的（真正分歧）；其他（倒退、跳號、同號不同內容）＝無法確認。都各自保留、不覆蓋（A12、A14）
        showConflict(key, cloud, !(cloud.rev === p.baseRev + 1)); return;
      }
      if (b && cloud.rev < b.rev) { showConflict(key, cloud, true); return; }   // 雲端倒退：不憑內容認領、不重傳（A14）
      if (cloud.rev === 0) {
        if (local !== null) { return startPending(key, local, 0, token); }
        saveBaseline(key, 0, null, null); return;
      }
      if (!b) {   // 第一次加入、雙邊都有資料：照 A4 不猜，各自保留
        if (local === null) { replaceLocal(key, cloud, token); }
        else { showConflict(key, cloud); }
        return;
      }
      // 本機已經和雲端一字不差（例如頁面寫進去了但讀回失敗，#1303 第 6 輪）：只補 baseline
      if (local !== null && local === cloud.data) { saveBaseline(key, cloud.rev, cloud.data, cloud.updated); delete conflicts[key]; delete deferred[key]; return; }
      if (cloud.rev === b.rev && contentHash(cloud.data) !== b.hash) { showConflict(key, cloud, true); return; }
      if (cloud.rev > b.rev) {
        if (contentHash(local) === b.hash) { replaceLocal(key, cloud, token); }
        else { showConflict(key, cloud, b.legacy === true); }   // 新版的 baseline 沒有 pending＝確定是另一台；舊版遷移來的＝無法確認
        return;
      }
      if (local !== null && contentHash(local) !== b.hash) { return startPending(key, local, b.rev, token); }
    }
    function reconcile(key, cloud, token) {
      if (pageOwned) { return recover(key, cloud, token, false); }
      assertActive(token);
      var local = read(key), meta = baseline(key), hash = observe(key, local).hash;
      needsGet[key] = false;
      if (cloud.rev === 0) {
        if (local !== null) { return put(key, local, 0, token); }
        saveBaseline(key, 0, null, null); return;
      }
      if (!meta) {
        if (local === null) { replaceLocal(key, cloud, token); }
        else { showConflict(key, cloud); }
        return;
      }
      if (cloud.rev < meta.rev || (cloud.rev === meta.rev && contentHash(cloud.data) !== meta.hash)) {
        showConflict(key, cloud); return;
      }
      if (cloud.rev > meta.rev) {
        if (hash === meta.hash) { replaceLocal(key, cloud, token); }
        else { showConflict(key, cloud); }
        return;
      }
      if (hash !== meta.hash && local !== null) { return put(key, local, meta.rev, token); }
    }
    function resetSession(nextCode) {
      epoch += 1; code = nextCode; needsGet = {}; conflicts = {}; decisions = {}; observed = {}; replaced = []; deferred = {};
      failures = 0; retryAt = 0; notice = '';
      if (retryTimer !== null) { root.clearTimeout(retryTimer); retryTimer = null; }
      keys.forEach(function (key) { needsGet[key] = true; });
      status = code ? '正在同步' : '尚未開啟同步';
    }
    function failure(err) {
      if (err.kind === 'stale') { return; }
      failures += 1;
      var delay = Math.min(60000, 4000 * Math.pow(2, Math.min(failures - 1, 4)));
      retryAt = now() + delay;
      status = err.kind === 'offline' ? '離線中，連上網路會自動補上' : '同步失敗，稍後自動再試';
      if (err.kind === 'storage' || err.name === 'QuotaExceededError') { notice = '本機儲存空間不足或無法使用，請保留原進度並檢查瀏覽器儲存設定。'; }
      if (err.kind === 'too-big') { notice = '這份進度超過 900000 字元，請先保留本機資料。'; }
      if (err.kind === 'journal') { notice = JOURNAL; }
      if (retryTimer !== null) { root.clearTimeout(retryTimer); }
      retryTimer = root.setTimeout(function () { retryTimer = null; sync(); }, delay);
    }
    function completed() {
      if (keys.some(function (key) { return !!conflicts[key]; })) {
        status = pageOwned ? keptStatus() : '有兩份進度，請選擇要保留的紀錄。'; return;
      }
      var dirty = keys.some(function (key) {
        var meta = baseline(key), local = read(key);
        return needsGet[key] || !meta || contentHash(local) !== meta.hash;
      });
      status = dirty ? '等待同步本機變更' : '已同步 ' + taipei(now(), false);
      if (keys.some(function (key) { return !!deferred[key]; })) { status = '雲端有較新的進度，回到首頁、存好後就會換上。'; }
      if (keys.some(function (key) { var meta = baseline(key); return meta && meta.rev > 0 && read(key) === null; })) {
        status = '這台的進度已移除，雲端紀錄保留；重新加入可下載。';
      }
    }
    function run(job, force) {
      if (destroyed || stopped) { return Promise.resolve(false); }
      if (busy) { return busy.then(function () { return run(job, force); }); }
      var token;
      busy = Promise.resolve().then(function () {
        var saved = read(CODE);
        if (saved !== code) { resetSession(saved && normalizeCode(saved) === saved ? saved : null); }
        if (!code || (!force && now() < retryAt)) { return false; }
        token = epoch;
        return job(token).then(function () {
          assertActive(token);
          failures = 0; retryAt = 0;
          notice = '';
          if (retryTimer !== null) { root.clearTimeout(retryTimer); retryTimer = null; }
          completed(); return true;
        });
      }).catch(function (err) {
        if (typeof token === 'undefined' || token === epoch) { failure(err); }
        return false;
      }).then(function (result) {
        busy = null;
        try { render(); } catch (ignoreRender) { /* Storage failures may also affect conflict display. */ }
        var callbacks = replaced; replaced = [];
        callbacks.forEach(function (key) {
          if (typeof options.onReplaced === 'function') {
            try { options.onReplaced(key); } catch (ignoreCallback) { /* Host callback cannot break the scheduler. */ }
          }
        });
        return result;
      });
      return busy;
    }
    function sync(force) {
      return run(function (token) {
        var chain = Promise.resolve();
        var firstError = null;
        keys.forEach(function (key) {
          chain = chain.then(function () {
            assertActive(token);
            if (decisions[key]) { return applyDecision(key, token); }
            if (conflicts[key]) { observe(key, read(key)); return; }
            if (pageOwned) {
              // 有待確認上傳：開頁先 GET 再進 recover；同頁重試直接重送同一份（衝突回應也進 recover）
              var ck = readCk(key);
              if (needsGet[key] || (!ck.baseline && !ck.pending)) {
                needsGet[key] = true;
                return request({op: 'get', key: key}, token).then(function (r) { return reconcile(key, r, token); });
              }
              if (ck.pending) { return sendPending(key, ck, token); }
              var mineNow = read(key);
              if (mineNow !== null && contentHash(mineNow) !== ck.baseline.hash) { return startPending(key, mineNow, ck.baseline.rev, token); }
              return;
            }
            if (needsGet[key]) {
              return request({op: 'get', key: key}, token).then(function (r) { return reconcile(key, r, token); });
            }
            var local = read(key), meta = baseline(key);
            if (!meta) {
              needsGet[key] = true;
              return request({op: 'get', key: key}, token).then(function (r) { return reconcile(key, r, token); });
            }
            if (observe(key, local).hash !== meta.hash && local !== null) { return put(key, local, meta.rev, token); }
          }).catch(function (err) {
            if (err.kind === 'stale') { throw err; }
            if (!firstError) { firstError = err; }
          });
        });
        return chain.then(function () { if (firstError) { throw firstError; } });
      }, force === true);
    }
    function activate(newCode) {
      // 有 accept 的頁面從同步連結（#sync=同一家庭碼）重開＝同一個家庭重新加入：保留 checkpoint 與 baseline，交給恢復判斷（A05–A08，第 8 輪）。
      // 換成不同家庭碼才作廢舊的待確認上傳（A16）。沒有 accept 的客戶端照舊一律清掉（A18）。
      if (pageOwned && read(CODE) === newCode) {
        stopped = false; resetSession(newCode); render();
        return sync(true);
      }
      // Clear the old baseline first. A partial storage failure then fails conservatively.
      storage.removeItem(META);
      if (pageOwned) { keys.forEach(function (key) { storage.removeItem(CKPT + key); }); }   // 換家庭：舊的待確認上傳作廢（A16）
      write(CODE, newCode);
      stopped = false; resetSession(newCode); render();
      return sync(true);
    }
    function enable() {
      if (code && !stopped) { return sync(true); }
      try {
        var random = options.random;
        if (!random && root.crypto && root.crypto.getRandomValues) { random = root.crypto.getRandomValues.bind(root.crypto); }
        if (random && typeof random !== 'function' && random.getRandomValues) { random = random.getRandomValues.bind(random); }
        if (!random) { throw error('random'); }
        var generated = '', tries = 0, limit = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
        while (generated.length < 12 && tries < 128) {
          var bytes = new Uint8Array(32); random(bytes); tries += 1;
          for (var i = 0; i < bytes.length && generated.length < 12; i += 1) {
            if (bytes[i] < limit) { generated += ALPHABET.charAt(bytes[i] % ALPHABET.length); }
          }
        }
        if (generated.length !== 12) { throw error('random'); }
        return activate(generated);
      } catch (err) {
        status = '同步失敗，稍後自動再試';
        notice = err.kind === 'random' ? '此瀏覽器無法安全產生同步碼，請使用 HTTPS 開啟網站。' : '無法儲存同步設定，請檢查瀏覽器儲存空間。';
        render(); return Promise.resolve(false);
      }
    }
    function join(value) {
      var normalized = normalizeCode(value);
      if (!normalized) { notice = BAD_CODE; render(); return Promise.resolve(false); }
      try { return activate(normalized); }
      catch (err) { failure(err); render(); return Promise.resolve(false); }
    }
    function applyDecision(key, token) {
      var cloud = conflicts[key], choice = decisions[key], action;
      if (!cloud || !choice) { delete decisions[key]; return Promise.resolve(); }
      if (choice === 'local') { action = put(key, read(key), cloud.rev, token, cloud); }
      else {
        // Re-fetch before accepting cloud: do not silently accept a version the parent never saw.
        action = request({op: 'get', key: key}, token).then(function (latest) {
          if (latest.rev !== cloud.rev || latest.data !== cloud.data) { showConflict(key, latest); return; }
          replaceLocal(key, latest, token);
        });
      }
      return action.then(function () { delete decisions[key]; });
    }
    function resolve(key, choice) {
      if (pageOwned) { return Promise.resolve(false); }   // 縮範圍：頁面擁有的 key 不提供選邊覆蓋
      if (destroyed || stopped || !conflicts[key] || decisions[key] || keys.indexOf(key) < 0 || (choice !== 'local' && choice !== 'cloud')) { return Promise.resolve(false); }
      decisions[key] = choice;
      render();
      return run(function (token) { return applyDecision(key, token); }, true);
    }
    function stop() {
      stopped = true; epoch += 1;
      if (activeAbort) { activeAbort.abort(); }
      if (retryTimer !== null) { root.clearTimeout(retryTimer); retryTimer = null; }
      code = null; conflicts = {}; decisions = {}; replaced = []; notice = '';
      var ok = true;
      try {
        storage.removeItem(CODE); storage.removeItem(META);
        if (pageOwned) { keys.forEach(function (key) { storage.removeItem(CKPT + key); }); }
      }
      catch (err) { ok = false; notice = '同步已暫停，但瀏覽器無法清除設定；請檢查儲存權限。'; }
      status = ok ? '這台已停止同步，進度仍保留。' : '同步已暫停';
      render(); return ok;
    }
    function visibility() { if (doc.visibilityState === 'hidden' && !stopped) { sync(true); } }
    function online() { if (!stopped) { sync(true); } }
    function storageEvent(event) {
      if (!event || event.key === CODE || event.key === META || keys.indexOf(event.key) >= 0 || event.key === null) {
        // A stop on another same-origin tab also prevents this tab's in-flight readback.
        if (!stopped) { sync(); }
      }
    }
    function hashInvitation() {
      if (!root.location || !root.history) { return null; }
      var parts = root.location.hash.replace(/^#/, '').split('&'), kept = [], invitation = null;
      parts.forEach(function (part) {
        if (/^sync=/.test(part)) {
          try { invitation = decodeURIComponent(part.slice(5)); } catch (ignore) { invitation = '!'; }
        } else if (part) { kept.push(part); }
      });
      if (invitation !== null) {
        root.history.replaceState(root.history.state, '', root.location.href.split('#')[0] + (kept.length ? '#' + kept.join('&') : ''));
      }
      return invitation;
    }
    var invitation = null;
    try {
      invitation = hashInvitation();
      var saved = read(CODE);
      if (saved && normalizeCode(saved) === saved) { resetSession(saved); }
      else if (saved) { notice = BAD_CODE; }
    } catch (err) { status = '同步失敗，稍後自動再試'; notice = '無法讀取同步設定，原進度保留。'; }
    render();
    doc.addEventListener('visibilitychange', visibility);
    if (root.addEventListener) { root.addEventListener('online', online); root.addEventListener('storage', storageEvent); }
    var interval = root.setInterval(function () { if (!stopped) { sync(); } }, 4000);
    var api = {
      enable: enable, join: join, stop: stop, sync: sync, resolve: resolve, link: link,
      getState: function () { return {code: code, status: status, notice: notice, conflicts: JSON.parse(JSON.stringify(conflicts)), retryAt: retryAt, failures: failures}; },
      destroy: function () {
        destroyed = true; epoch += 1; replaced = [];
        root.clearInterval(interval); if (retryTimer !== null) { root.clearTimeout(retryTimer); }
        if (activeAbort) { activeAbort.abort(); }
        doc.removeEventListener('visibilitychange', visibility);
        if (root.removeEventListener) { root.removeEventListener('online', online); root.removeEventListener('storage', storageEvent); }
      }
    };
    api.ready = invitation !== null ? join(invitation) : sync();
    return api;
  }
  return {init: init, normalizeCode: normalizeCode, contentHash: contentHash};
}));
