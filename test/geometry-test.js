/*
 * ジオメトリ計算のテストハーネス。
 *
 * KWin の API (workspace / KWin / readConfig / registerShortcut) をスタブして
 * main.js を Node.js 上で実行し、計算結果を検証する。実行中の KWin には一切
 * 触れないので、デスクトップを使いながら安全に回せる。
 *
 *   node test/geometry-test.js
 */

const fs = require('fs');
const vm = require('vm');

const AREA = { x: 0, y: 0, width: 2560, height: 1400 };
let CONFIG = {};
const handlers = {};

function makeWin(geo, opts) {
  opts = opts || {};
  return {
    normalWindow: true, moveable: true, resizeable: opts.resizeable !== false,
    minimized: false, fullScreen: false,
    minSize: opts.minSize || { width: 0, height: 0 },
    internalId: opts.id || "{win-1}",
    desktops: [{ name: "d1" }],
    output: { name: "DP-2" },
    tile: null,
    frameGeometry: geo,
    setMaximize() {},
  };
}

let currentWin = null;
const sandbox = {
  console,
  readConfig: (k, d) => (k in CONFIG ? CONFIG[k] : d),
  registerShortcut: (name, desc, seq, cb) => { handlers[name] = cb; return true; },
  KWin: { MaximizeArea: 2, FullArea: 6 },
  workspace: {
    get activeWindow() { return currentWin; },
    currentDesktop: { name: "d1" },
    clientArea: () => ({ ...AREA }),
    windowRemoved: { connect() {} },
  },
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(__dirname + '/../package/contents/code/main.js', 'utf8'), sandbox);

function run(action, geo, cfg, opts) {
  CONFIG = cfg || {};
  currentWin = makeWin(geo, opts);
  handlers["Rectangle: " + action]();
  const g = currentWin.frameGeometry;
  return { x: g.x, y: g.y, width: g.width, height: g.height };
}

let fails = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log((ok ? "  ok   " : "  FAIL ") + label + "  got=" + JSON.stringify(got) +
              (ok ? "" : "  want=" + JSON.stringify(want)));
}

const full = { x: 0, y: 0, width: 2560, height: 1400 };
const small = { x: 500, y: 400, width: 800, height: 600 };

console.log("--- gap なし ---");
eq("LeftHalf",   run("LeftHalf", full),   { x: 0, y: 0, width: 1280, height: 1400 });
eq("RightHalf",  run("RightHalf", full),  { x: 1280, y: 0, width: 1280, height: 1400 });
eq("TopHalf",    run("TopHalf", full),    { x: 0, y: 0, width: 2560, height: 700 });
eq("BottomHalf", run("BottomHalf", full), { x: 0, y: 700, width: 2560, height: 700 });
eq("TopLeft",    run("TopLeft", full),    { x: 0, y: 0, width: 1280, height: 700 });
eq("BottomRight",run("BottomRight", full),{ x: 1280, y: 700, width: 1280, height: 700 });
eq("FirstThird", run("FirstThird", full), { x: 0, y: 0, width: 853, height: 1400 });
eq("LastThird",  run("LastThird", full),  { x: 1707, y: 0, width: 853, height: 1400 });
eq("Maximize",   run("Maximize", small),  full);
eq("BottomRightSixth", run("BottomRightSixth", full), { x: 1707, y: 700, width: 853, height: 700 });
eq("CenterHalf",  run("CenterHalf", full),  { x: 640, y: 0, width: 1280, height: 1400 });

console.log("--- gap 8 ---");
const g8 = { gapSize: 8 };
eq("LeftHalf",   run("LeftHalf", full, g8),   { x: 8, y: 8, width: 1268, height: 1384 });
eq("RightHalf",  run("RightHalf", full, g8),  { x: 1284, y: 8, width: 1268, height: 1384 });
eq("TopHalf",    run("TopHalf", full, g8),    { x: 8, y: 8, width: 2544, height: 688 });
eq("BottomHalf", run("BottomHalf", full, g8), { x: 8, y: 704, width: 2544, height: 688 });
eq("Maximize",   run("Maximize", small, g8),  { x: 8, y: 8, width: 2544, height: 1384 });
eq("CenterHalf", run("CenterHalf", full, g8), { x: 648, y: 8, width: 1264, height: 1384 });

console.log("--- 特殊 ---");
eq("AlmostMaximize", run("AlmostMaximize", small), { x: 128, y: 70, width: 2304, height: 1260 });
eq("Center",         run("Center", small),         { x: 880, y: 400, width: 800, height: 600 });
eq("MaximizeHeight", run("MaximizeHeight", small), { x: 500, y: 0, width: 800, height: 1400 });
eq("MoveLeft",       run("MoveLeft", small),       { x: 0, y: 400, width: 800, height: 600 });
eq("MoveRight",      run("MoveRight", small),      { x: 1760, y: 400, width: 800, height: 600 });
eq("MoveTop",        run("MoveTop", small),        { x: 880, y: 0, width: 800, height: 600 });
eq("MoveBottom",     run("MoveBottom", small),     { x: 880, y: 800, width: 800, height: 600 });
eq("MakeLarger",     run("MakeLarger", small),     { x: 485, y: 385, width: 830, height: 630 });
eq("MakeSmaller",    run("MakeSmaller", small),    { x: 515, y: 415, width: 770, height: 570 });

console.log("--- 固定サイズウィンドウ（resizeable=false）---");
eq("LeftHalf(fixed)", run("LeftHalf", small, {}, { resizeable: false }),
   { x: 240, y: 400, width: 800, height: 600 });
eq("Center(fixed)",   run("Center", small, {}, { resizeable: false }),
   { x: 880, y: 400, width: 800, height: 600 });

console.log("--- minSize によるせり上がり ---");
eq("BottomRightSixth(minSize)", run("BottomRightSixth", full, {}, { minSize: { width: 1000, height: 800 } }),
   { x: 1560, y: 600, width: 1000, height: 800 });

console.log(fails === 0 ? "\nALL PASS" : "\n" + fails + " FAILED");
