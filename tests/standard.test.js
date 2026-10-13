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
  ["src/core.js", "src/wrongbank.js", "src/tones.js"].forEach((f) => {
    const js = fs.readFileSync(path.join(ROOT, f), "utf8");
    assert.ok(html.includes(js), f + " 沒有內嵌最新版：請跑 python3 build.py");
  });
});
