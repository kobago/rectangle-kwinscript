/*
 * 履歴管理と Restore のテストハーネス。詳細は geometry-test.js の冒頭を参照。
 *
 *   node test/history-test.js
 */
const fs = require('fs'), vm = require('vm');
const AREA = { x: 0, y: 0, width: 2560, height: 1400 };
const handlers = {};
let currentWin = null;
const sandbox = {
  console,
  readConfig: (k, d) => d,
  registerShortcut: (n, d, s, cb) => { handlers[n] = cb; return true; },
  KWin: { MaximizeArea: 2 },
  workspace: {
    get activeWindow() { return currentWin; },
    currentDesktop: { name: "d1" },
    clientArea: () => ({ ...AREA }),
    windowRemoved: { connect() {} },
  },
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(__dirname + '/../package/contents/code/main.js', 'utf8'), sandbox);

const ORIG = { x: 500, y: 400, width: 800, height: 600 };
currentWin = {
  normalWindow: true, moveable: true, resizeable: true, minimized: false,
  fullScreen: false, minSize: { width: 0, height: 0 }, internalId: "{w1}",
  desktops: [{ name: "d1" }], output: {}, tile: null,
  frameGeometry: { ...ORIG }, setMaximize() {},
};
const go = a => handlers["Rectangle: " + a]();
const geo = () => JSON.stringify(currentWin.frameGeometry);
const count = () => vm.runInContext('lastAction["{w1}"] ? lastAction["{w1}"].action + ":" + lastAction["{w1}"].count : "none"', sandbox);
const restore = () => vm.runInContext('JSON.stringify(restoreGeometry["{w1}"] || null)', sandbox);

let fails = 0;
const chk = (l, g, w) => { const ok = g === w; if (!ok) fails++; console.log((ok?"  ok   ":"  FAIL ")+l+"  "+g+(ok?"":"  want="+w)); };

console.log("--- 連続実行による count の伸び（Phase 2 の土台）---");
go("LeftHalf"); chk("1回目", count(), "LeftHalf:1"); chk("  restore に元ジオメトリ", restore(), JSON.stringify(ORIG));
go("LeftHalf"); chk("2回目", count(), "LeftHalf:2"); chk("  restore 維持", restore(), JSON.stringify(ORIG));
go("LeftHalf"); chk("3回目", count(), "LeftHalf:3");
go("RightHalf");chk("別アクションで 1 にリセット", count(), "RightHalf:1");
chk("  restore は元のまま", restore(), JSON.stringify(ORIG));

console.log("--- Restore ---");
go("Restore");
chk("元のジオメトリへ復帰", geo(), JSON.stringify(ORIG));
chk("履歴クリア", count(), "none");
chk("restore クリア", restore(), "null");

console.log("--- 手動移動を挟むと restore が更新される ---");
go("LeftHalf");
currentWin.frameGeometry = { x: 111, y: 222, width: 800, height: 600 };  // ユーザーが手で動かした
go("TopHalf");
chk("restore が手動移動後の位置に更新", restore(), JSON.stringify({ x: 111, y: 222, width: 800, height: 600 }));
chk("count は 1 から", count(), "TopHalf:1");
go("Restore");
chk("手動位置へ戻る", geo(), JSON.stringify({ x: 111, y: 222, width: 800, height: 600 }));

console.log(fails === 0 ? "\nALL PASS" : "\n" + fails + " FAILED");
