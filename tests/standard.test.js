// 錯題站的固定標準：題庫每題合格、白話（小五每句 ≤40 字）、隱私、六站切換列順序、不被搜尋引擎收錄。
// 這是秒級粗篩；切換列與頁面行為的主閘是真瀏覽器 tests/e2e.py。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const C = require("../src/core.js");
const B = require("../src/wrongbank.js");
const ROOT = path.join(__dirname, "..");
const MAX_SENTENCE = 40;   // 小五每句上限，與難題站 src/hard.js READING[5] 相同
// 六站順序（2026-10-13 律師：難題解說放最右；錯題複習加在它左邊）＝各科在前、跨科工具在後
const ORDER = [
  ["https://windsorya.github.io/g5-sci-review/", "五上自然複習"],
  ["https://windsorya.github.io/g5-math-review/", "五上數學複習"],
  ["https://windsorya.github.io/g5-chinese-review/", "五上國語複習"],
  ["https://windsorya.github.io/g5-social-review/", "五上社會複習"],
  ["https://windsorya.github.io/g5-wrong-review/", "錯題複習"],
  ["https://windsorya.github.io/g5-help/", "難題解說"],
];
const SELF = "錯題複習";
const sentences = (t) => String(t).split(/[。！？\n；]/).map((s) => s.trim()).filter(Boolean);

test("題庫每題合格、id 不重複", () => {
  const seen = new Set();
  B.ITEMS.forEach((it) => {
    assert.deepEqual(C.itemProblems(it), [], it.id);
    assert.ok(!seen.has(it.id), "id 重複：" + it.id); seen.add(it.id);
  });
});

test("白話：解說每句 ≤40 字", () => {
  B.ITEMS.forEach((it) => sentences(it.why).forEach((s) => assert.ok([...s].length <= MAX_SENTENCE, it.id + " 句子太長（" + [...s].length + " 字）：" + s)));
});

test("隱私：題庫不放照片、不放網址以外的圖", () => {
  const src = fs.readFileSync(path.join(ROOT, "src", "wrongbank.js"), "utf8");
  assert.ok(!/data:image\//.test(src), "題庫不可內嵌照片");
  assert.ok(!/\.(jpe?g|png|heic)\b/i.test(src.replace(/^\s*\/\/.*$/gm, "")), "題庫不可引用照片檔");
});

function navItems(html) {
  const m = /<nav id="siteNav"[^>]*>([\s\S]*?)<\/nav>/.exec(html);
  assert.ok(m, "找不到 siteNav");
  const out = [], re = /<(a|span)\b([^>]*)>([^<]*)<\/\1>/g;
  let x;
  while ((x = re.exec(m[1]))) {
    const href = /\shref="([^"]*)"/.exec(" " + x[2]);
    out.push({ tag: x[1], href: href ? href[1] : null, current: /aria-current="page"/.test(x[2]), text: x[3].trim() });
  }
  return out;
}

test("六站切換列：順序固定、本站是 aria-current、其他五站是連結", () => {
  ["src/app.html", "index.html"].forEach((f) => {
    const items = navItems(fs.readFileSync(path.join(ROOT, f), "utf8"));
    assert.deepEqual(items.map((i) => i.text), ORDER.map((o) => o[1]), f + " 順序不對");
    items.forEach((it, k) => {
      if (it.text === SELF) { assert.ok(it.current && it.tag === "span", f + " 本站要是 aria-current 的 span"); }
      else { assert.equal(it.href, ORDER[k][0], f + " " + it.text + " 連結不對"); assert.ok(!it.current); }
    });
  });
});

test("自檢：切換列順序換掉要抓得到", () => {
  const html = fs.readFileSync(path.join(ROOT, "src", "app.html"), "utf8");
  const swapped = html.replace("五上自然複習</a>", "五上自然複習X</a>");
  assert.notDeepEqual(navItems(swapped).map((i) => i.text), ORDER.map((o) => o[1]));
});

test("不被搜尋引擎收錄：index.html 有 robots noindex、robots.txt 全擋", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  assert.match(html.slice(0, 600), /<meta name="robots" content="noindex,nofollow">/);
  assert.match(fs.readFileSync(path.join(ROOT, "robots.txt"), "utf8"), /Disallow: \/\s*$/m);
});

test("index.html 是最新 build（src 改了要重跑 build.py）", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  ["src/core.js", "src/wrongbank.js", "src/tones.js", "src/appweak.js"].forEach((f) => {
    const js = fs.readFileSync(path.join(ROOT, f), "utf8");
    assert.ok(html.includes(js), f + " 沒有內嵌最新版：請跑 python3 build.py");
  });
});

// ===== 各科 app 待加強（#3016，docs/app-weak-entry-design-20261019.md）的固定標準 =====
const AW = require("../src/appweak.js");

test("各科待加強：四科順序與網址同切換列前四站、key 都在家庭同步白名單", () => {
  assert.deepEqual(AW.SUBJECTS.map((s) => s.home), ORDER.slice(0, 4).map((o) => o[0]));
  assert.deepEqual(AW.SUBJECTS.map((s) => s.name), ["自然", "數學", "國語", "社會"]);
  const sync = fs.readFileSync(path.join(ROOT, "tests", "vendor", "g5-help-sync.js"), "utf8");
  const keys = JSON.parse(/var KEYS = (\[[^\]]*\])/.exec(sync)[1].replace(/'/g, '"'));
  AW.SUBJECTS.forEach((s) => assert.ok(keys.includes(s.key), s.key + " 不在同步白名單"));
  AW.SUBJECTS.forEach((s) => assert.equal(s.exportUrl, s.home + "weak-export.js"));
});

test("各科待加強：GAS 端點三處（上傳、同步、待加強）一字不差", () => {
  const html = fs.readFileSync(path.join(ROOT, "src", "app.html"), "utf8");
  const eps = html.match(/https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec/g) || [];
  assert.equal(eps.length, 3, "應有三處：" + eps.length);
  assert.equal(new Set(eps).size, 1, "三處端點不一致");
});

// I1：四個科目 key 只讀不寫。appweak.js 整檔、app.html 的待加強那段 script 都不得出現任何寫入 storage 的呼叫
function appWeakScript(html) {
  const m = /<script>\n\/\/ 各科 app 待加強[\s\S]*?<\/script>/.exec(html);
  assert.ok(m, "找不到待加強那段 script");
  return m[0];
}
test("各科待加強 I1：只讀，不寫 localStorage（appweak.js 與網頁那段 script）", () => {
  const html = fs.readFileSync(path.join(ROOT, "src", "app.html"), "utf8");
  [fs.readFileSync(path.join(ROOT, "src", "appweak.js"), "utf8"), appWeakScript(html)].forEach((src) => {
    assert.ok(!/\b(setItem|removeItem|clear)\s*\(/.test(src), "出現寫入 storage 的呼叫");
    assert.ok(!/localStorage\s*\[[^\]]*\]\s*=(?!=)/.test(src), "出現 localStorage[...] 指派");
  });
});
test("自檢：待加強那段多一個 setItem 要抓得到", () => {
  const html = fs.readFileSync(path.join(ROOT, "src", "app.html"), "utf8");
  const bad = html.replace("function get(k){", "function get(k){ localStorage.setItem('g5sci.v3','x');");
  assert.ok(/\bsetItem\s*\(/.test(appWeakScript(bad)));
});
