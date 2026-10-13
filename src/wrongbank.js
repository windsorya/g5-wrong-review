// 錯題本題庫：學校小考答錯的題目，一題一個物件。
// 加題流程（律師在本站或難題站「上傳錯題」→ ~/scripts/g5_help_inbox.py 取回 → 記成交辦）：
//   ①看照片，題目重新打字（不貼原圖；網頁與 GitHub 原始檔公開，不放名字、學校、班級、老師批改字跡）
//   ②答案獨立查證：數學用程式算、其他科查課本用語；填充題把可接受的寫法都列進 a
//   ③why 寫「為什麼是這個答案」＋「容易錯在哪」，小五每句 ≤40 字、難詞第一次出現加白話
//   ④her 寫她當時的錯答案（照片看得到才寫；看不清楚就不寫，禁猜）
//   ⑤node --test tests/*.test.js、python3.12 tests/e2e.py，push 後 g5_help_inbox.py --done <傳題 ID> <id>
// 欄位：id（w-科目代號-月日-序號）、subject（國語／數學／自然／社會／英文／其他）、source（哪一次小考）、added（加入日 YYYY-MM-DD）、
//       type（choice 選擇／tf 是非／fill 填充）、q 題目、opts 選項（choice）、a 答案（choice＝選項編號、tf＝true/false、fill＝可接受寫法陣列）、
//       her（她當時寫的，可省）、why 解說、upload（傳題 ID，可省）
(function (root) {
  "use strict";
  var ITEMS = [
  ];
  var api = { ITEMS: ITEMS };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.G5WrongBank = api;
})(typeof window !== "undefined" ? window : this);
