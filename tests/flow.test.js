// 頁首流程條（2026-10-18 加）的天數必須跟核心排程一致：畫面上的數字由資料決定，不准寫死後漂移。
// Codex 審 94d266b：原本寫「第 1 天→第 2 天→第 3 天→學會」，實際 GAP＝[0,1,3]：答對→明天再出→再答對→3 天後再出，第 5 天才學會。
// 執行：node --test tests/flow.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const C = require("../src/core.js");

const html = fs.readFileSync(path.join(__dirname, "../src/app.html"), "utf8");
function flowLabels(src) {
  const m = /<div class="flow"[^>]*>([\s\S]*?)<\/div>/.exec(src);
  assert.ok(m, "找不到流程條");
  return [...m[1].matchAll(/<span class="st"><span class="dot[^"]*">[\s\S]*?<\/span>([^<]*(?:<br>[^<]*)?)<\/span>/g)].map((x) => x[1].replace("<br>", ""));
}
const later = (d) => (d === 1 ? "明天" : d + " 天後");
function expected(gap, master) {
  const out = ["第 1 次答對"];
  for (let s = 1; s < master; s++) out.push(later(gap[s]) + "再答對");
  return out.concat(["學會了"]);
}

test("流程條：每一步的天數照核心 GAP、步數照 MASTER", () => {
  assert.deepEqual(flowLabels(html), expected(C.GAP, C.MASTER));
});
test("流程條自檢：舊寫法「第 1／2／3 天答對」要抓到；間隔改成 2 天時也要抓到", () => {
  const old = html.replace("第 1 次<br>答對", "第 1 天<br>答對").replace("明天<br>再答對", "第 2 天<br>答對").replace("3 天後<br>再答對", "第 3 天<br>答對");
  assert.notDeepEqual(flowLabels(old), expected(C.GAP, C.MASTER));
  assert.notDeepEqual(flowLabels(html), expected([0, 2, 3], C.MASTER));
});
test("流程條講的就是核心實際排程：真的呼叫 record() 走一遍，每一步到期日照流程條、第三次答對才學會", () => {
  let st = C.blank(), day = "2026-10-01";
  const labels = flowLabels(html);
  for (let i = 1; i < labels.length; i++) {
    st = C.record(st, "a", true, day).state;
    if (labels[i] === "學會了") { assert.equal(st.it.a.m, true, "最後一步答對要學會"); break; }
    assert.equal(st.it.a.m, false, "還沒到最後一步不能先學會");
    const gap = labels[i].startsWith("明天") ? 1 : Number(/^(\d+) 天後/.exec(labels[i])[1]);
    assert.equal(st.it.a.due, C.addDays(day, gap), "第 " + i + " 次答對後的到期日要符合「" + labels[i] + "」");
    day = st.it.a.due;
  }
});
