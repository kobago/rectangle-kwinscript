/*
 * Rectangle for KWin
 *
 * macOS の Rectangle (https://github.com/rxhanson/Rectangle, MIT License) を
 * KWin 6 (Plasma 6) スクリプトへ移植したもの。オリジナルの作者は Ryan Hanson。
 *
 * ライセンス: MIT (LICENSE 参照)
 *
 * ログの確認方法:
 *   journalctl --user -b -f | grep rectangle-kwin
 *   (設定の debug を true にすると出力される)
 *
 * 実装は docs/DESIGN.md を仕様書とする。本ファイルは単一ファイルで完結させる
 * 必要がある。KWin のスクリプトサンドボックスには require / import が無く、
 * 複数ファイルを読み込めないため。
 */

/* ========================================================================
 * 1. 設定読み込み
 * ==================================================================== */

// ショートカット実行のたびに読み直す想定なので、直近に読んだ設定を保持して
// log() から参照できるようにしておく。
var currentConfig = null;

function loadConfig() {
    var cfg = {};
    cfg.gapSize = readConfig("gapSize", 0);
    cfg.screenEdgeGapTop = readConfig("screenEdgeGapTop", 0);
    cfg.screenEdgeGapBottom = readConfig("screenEdgeGapBottom", 0);
    cfg.screenEdgeGapLeft = readConfig("screenEdgeGapLeft", 0);
    cfg.screenEdgeGapRight = readConfig("screenEdgeGapRight", 0);
    cfg.applyGapsToMaximize = readConfig("applyGapsToMaximize", true);
    cfg.almostMaximizeWidth = readConfig("almostMaximizeWidth", 0.9);
    cfg.almostMaximizeHeight = readConfig("almostMaximizeHeight", 0.9);
    cfg.sizeOffset = readConfig("sizeOffset", 30);
    cfg.minimumWindowWidth = readConfig("minimumWindowWidth", 0);
    cfg.minimumWindowHeight = readConfig("minimumWindowHeight", 0);
    cfg.centeredDirectionalMove = readConfig("centeredDirectionalMove", true);
    cfg.curtainChangeSize = readConfig("curtainChangeSize", true);
    cfg.debug = readConfig("debug", false);

    // §7 の注記どおり、範囲外の値は既定値へ丸める。
    if (!(cfg.almostMaximizeWidth > 0 && cfg.almostMaximizeWidth <= 1)) {
        cfg.almostMaximizeWidth = 0.9;
    }
    if (!(cfg.almostMaximizeHeight > 0 && cfg.almostMaximizeHeight <= 1)) {
        cfg.almostMaximizeHeight = 0.9;
    }
    if (cfg.sizeOffset <= 0) {
        cfg.sizeOffset = 30;
    }

    currentConfig = cfg;
    return cfg;
}

function log(msg) {
    if (currentConfig && currentConfig.debug) {
        console.info("rectangle-kwin: " + msg);
    }
}

/* ========================================================================
 * 2. ジオメトリ用ヘルパー
 * ==================================================================== */

// Qt グローバルは存在しないため、矩形は常にプレーンオブジェクトで扱う。
function cloneRect(r) {
    return { x: r.x, y: r.y, width: r.width, height: r.height };
}

function clamp(v, min, max) {
    if (max < min) {
        max = min;
    }
    return Math.min(max, Math.max(min, v));
}

// 履歴比較用の許容誤差付き一致判定（§6: リサイズ増分によるズレを吸収するため ±2px）。
function rectsNearlyEqual(a, b, tolerance) {
    return Math.abs(a.x - b.x) <= tolerance &&
        Math.abs(a.y - b.y) <= tolerance &&
        Math.abs(a.width - b.width) <= tolerance &&
        Math.abs(a.height - b.height) <= tolerance;
}

/* ========================================================================
 * 3. 作業領域
 * ==================================================================== */

function getWorkArea(win, cfg) {
    var desktop = (win.desktops && win.desktops.length > 0) ? win.desktops[0] : workspace.currentDesktop;
    // clientArea の戻り値は QML の値型なので、書き換える前に必ずプレーン
    // オブジェクトへコピーする。
    var raw = workspace.clientArea(KWin.MaximizeArea, win.output, desktop);
    var area = { x: raw.x, y: raw.y, width: raw.width, height: raw.height };

    // 画面端 gap を差し引く（本家 adjustedVisibleFrame 相当、y 反転済み）。
    area.x += cfg.screenEdgeGapLeft;
    area.width -= (cfg.screenEdgeGapLeft + cfg.screenEdgeGapRight);
    area.y += cfg.screenEdgeGapTop;
    area.height -= (cfg.screenEdgeGapTop + cfg.screenEdgeGapBottom);

    return area;
}

/* ========================================================================
 * 4. 対象ウィンドウ
 * ==================================================================== */

// resizeable は条件に含めない。サイズ変更できないウィンドウ（固定サイズの
// ダイアログ等）でも移動はできるため、除外すると Center や Move 系が一切
// 効かなくなる。サイズの扱いは fitRect() 側で分岐する。
function getTargetWindow() {
    var w = workspace.activeWindow;
    if (!w) { return null; }
    if (!w.normalWindow) { return null; }
    if (!w.moveable) { return null; }
    if (w.minimized) { return null; }
    return w;
}

// ジオメトリ書き込み前に必ずタイル状態を解除する。これが無いと Quick Tile /
// 最大化済みのウィンドウで frameGeometry への書き込みが無視される（最重要の
// 落とし穴。前回の試作はこれを欠いていた）。各操作は個別に try/catch する
// — w.tile = null は一部のウィンドウ種別で例外を投げることがあり、それで
// 後続の解除やジオメトリ書き込みを止めてはいけない。
function unsnap(w) {
    try {
        if (w.fullScreen) {
            w.fullScreen = false;
        }
    } catch (e) {
        log("unsnap: fullScreen 解除に失敗: " + e);
    }
    try {
        w.setMaximize(false, false);
    } catch (e) {
        log("unsnap: setMaximize に失敗: " + e);
    }
    try {
        w.tile = null;
    } catch (e) {
        log("unsnap: tile 解除に失敗: " + e);
    }
}

/* ========================================================================
 * 5. 分数テーブル（半分 / 1/4 / 1/3 系 / 1/6）+ gap の共有辺メタ情報
 * ==================================================================== */

// 比率は作業領域に対する割合、座標は左上原点（DESIGN.md §4）。
// sharedEdges は applyGaps() が半分だけ内側 gap を戻すために使う視覚的な
// 辺の名前。1/3 系・1/6 は本家準拠で共有辺を持たない（意図的な挙動）。
var FRACTION_ACTIONS = {
    "LeftHalf":   { x: 0,   y: 0,   w: 1 / 2, h: 1,     sharedEdges: ["right"] },
    "RightHalf":  { x: 1 / 2, y: 0,   w: 1 / 2, h: 1,     sharedEdges: ["left"] },
    // 幅 1/2・高さいっぱいを水平中央に置く（本家 centerHalf）。左右どちらとも
    // 接しないため共有辺は持たない。
    "CenterHalf": { x: 1 / 4, y: 0,   w: 1 / 2, h: 1,     sharedEdges: [] },
    "TopHalf":    { x: 0,   y: 0,   w: 1,     h: 1 / 2, sharedEdges: ["bottom"] },
    "BottomHalf": { x: 0,   y: 1 / 2, w: 1,     h: 1 / 2, sharedEdges: ["top"] },

    "TopLeft":     { x: 0,   y: 0,   w: 1 / 2, h: 1 / 2, sharedEdges: ["bottom", "right"] },
    "TopRight":    { x: 1 / 2, y: 0,   w: 1 / 2, h: 1 / 2, sharedEdges: ["bottom", "left"] },
    "BottomLeft":  { x: 0,   y: 1 / 2, w: 1 / 2, h: 1 / 2, sharedEdges: ["top", "right"] },
    "BottomRight": { x: 1 / 2, y: 1 / 2, w: 1 / 2, h: 1 / 2, sharedEdges: ["top", "left"] },

    "FirstThird":     { x: 0,     y: 0, w: 1 / 3, h: 1, sharedEdges: [] },
    "CenterThird":    { x: 1 / 3, y: 0, w: 1 / 3, h: 1, sharedEdges: [] },
    "LastThird":      { x: 2 / 3, y: 0, w: 1 / 3, h: 1, sharedEdges: [] },
    "FirstTwoThirds": { x: 0,     y: 0, w: 2 / 3, h: 1, sharedEdges: [] },
    "LastTwoThirds":  { x: 1 / 3, y: 0, w: 2 / 3, h: 1, sharedEdges: [] },

    "TopLeftSixth":      { x: 0,     y: 0,     w: 1 / 3, h: 1 / 2, sharedEdges: [] },
    "TopCenterSixth":    { x: 1 / 3, y: 0,     w: 1 / 3, h: 1 / 2, sharedEdges: [] },
    "TopRightSixth":     { x: 2 / 3, y: 0,     w: 1 / 3, h: 1 / 2, sharedEdges: [] },
    "BottomLeftSixth":   { x: 0,     y: 1 / 2, w: 1 / 3, h: 1 / 2, sharedEdges: [] },
    "BottomCenterSixth": { x: 1 / 3, y: 1 / 2, w: 1 / 3, h: 1 / 2, sharedEdges: [] },
    "BottomRightSixth":  { x: 2 / 3, y: 1 / 2, w: 1 / 3, h: 1 / 2, sharedEdges: [] }
};

function calcFractionRect(spec, area) {
    return {
        x: area.x + spec.x * area.width,
        y: area.y + spec.y * area.height,
        width: spec.w * area.width,
        height: spec.h * area.height
    };
}

/* ========================================================================
 * 6. 特殊アクションの計算（Maximize / MaximizeHeight / AlmostMaximize /
 *    Center / MakeLarger・MakeSmaller / Move×4）
 * ==================================================================== */

function calcMaximize(win, area) {
    return { x: area.x, y: area.y, width: area.width, height: area.height };
}

function calcMaximizeHeight(win, area) {
    var cur = win.frameGeometry;
    return { x: cur.x, y: area.y, width: cur.width, height: area.height };
}

function calcAlmostMaximize(win, area, cfg) {
    var w = Math.round(area.width * cfg.almostMaximizeWidth);
    var h = Math.round(area.height * cfg.almostMaximizeHeight);
    var x = Math.round(area.x + (area.width - w) / 2);
    var y = Math.round(area.y + (area.height - h) / 2);
    return { x: x, y: y, width: w, height: h };
}

// 本家 CenterCalculation の移植（y 反転済み、DESIGN.md §4.6）。
function calcCenter(win, area) {
    var cur = win.frameGeometry;
    var heightExceeded = cur.height > area.height;
    var widthExceeded = cur.width > area.width;

    if (heightExceeded && widthExceeded) {
        return calcMaximize(win, area);
    }

    var r = cloneRect(cur);

    if (heightExceeded) {
        r.height = area.height;
        r.y = area.y;
    } else {
        r.y = Math.round((area.height - cur.height) / 2) + area.y;
    }

    if (widthExceeded) {
        r.width = area.width;
        r.x = area.x;
    } else {
        r.x = Math.round((area.width - cur.width) / 2) + area.x;
    }

    return r;
}

// 本家 ChangeSizeCalculation の移植（DESIGN.md §4.7）。larger が true なら
// +sizeOffset、false なら -sizeOffset として扱う。
function calcChangeSize(win, area, cfg, larger) {
    var orig = cloneRect(win.frameGeometry);
    var offset = larger ? cfg.sizeOffset : -cfg.sizeOffset;

    // 「画面端に接している」の判定閾値。gapSize が 0 以下なら 5px を使う。
    var edgeGap = (cfg.gapSize <= 0) ? 5 : cfg.gapSize;
    var touchLeft = Math.abs(orig.x - area.x) <= edgeGap;
    var touchRight = Math.abs((orig.x + orig.width) - (area.x + area.width)) <= edgeGap;
    var touchTop = Math.abs(orig.y - area.y) <= edgeGap;
    var touchBottom = Math.abs((orig.y + orig.height) - (area.y + area.height)) <= edgeGap;

    var r = cloneRect(orig);

    // 幅
    r.width += offset;
    r.x -= Math.floor(offset / 2);
    if (cfg.curtainChangeSize) {
        // カーテン補正（左右）: 元の矩形がどちらの画面端に接していたかで
        // リサイズ後の x を決め直す。両方に接していた（画面幅いっぱい）場合は
        // 幅も gap 分だけ残して両端に吸着させる。
        if (touchRight) {
            r.x = (area.x + area.width) - r.width - cfg.gapSize;
            if (touchLeft) {
                r.width = area.width - cfg.gapSize * 2;
            }
        }
        if (touchLeft) {
            r.x = area.x + cfg.gapSize;
        }
    }
    if (r.width >= area.width) {
        r.width = area.width;
    }

    // 高さ（Phase 1 には smallerHeight 単体アクションが無いため、DESIGN.md の
    // 指示どおり MakeLarger / MakeSmaller の両方でカーテン補正を適用する）。
    r.height += offset;
    r.y -= Math.floor(offset / 2);
    if (cfg.curtainChangeSize) {
        if (touchBottom) {
            r.y = (area.y + area.height) - r.height - cfg.gapSize;
            if (touchTop) {
                r.height = area.height - cfg.gapSize * 2;
            }
        }
        if (touchTop) {
            r.y = area.y + cfg.gapSize;
        }
    }
    if (r.height >= area.height) {
        r.height = area.height;
        r.y = orig.y;
    }

    // 四辺すべてが画面端に接していて縮小する場合は、元の矩形を基準に対称に
    // 縮める（カーテン補正だけでは中央に寄ってしまうケースの救済）。
    if (touchLeft && touchRight && touchTop && touchBottom && offset < 0) {
        // offset は負なので floor(offset / 2) も負。本家と同じ式にしておかないと
        // sizeOffset が奇数のときに 1px ずれる。
        r.x = orig.x - Math.floor(offset / 2);
        r.y = orig.y - Math.floor(offset / 2);
        r.width = orig.width + offset;
        r.height = orig.height + offset;
    }

    // 縮小しすぎたら何もしない。
    if (offset < 0 && (r.width < cfg.minimumWindowWidth || r.height < cfg.minimumWindowHeight)) {
        r = cloneRect(orig);
    }

    return r;
}

// 本家 MoveLeftRightCalculation / MoveUpDownCalculation の移植（DESIGN.md §4.8）。
// resizeOnDirectionalMove は既定 false のためサイズは変更しない。
function calcMove(win, area, cfg, direction) {
    var cur = win.frameGeometry;
    var r = cloneRect(cur);
    var horizontal = (direction === "left" || direction === "right");

    if (direction === "left") {
        r.x = area.x;
    } else if (direction === "right") {
        r.x = area.x + area.width - cur.width;
    } else if (direction === "top") {
        r.y = area.y;
    } else if (direction === "bottom") {
        r.y = area.y + area.height - cur.height;
    }

    if (cfg.centeredDirectionalMove) {
        if (horizontal) {
            r.y = Math.round((area.height - cur.height) / 2) + area.y;
        } else {
            r.x = Math.round((area.width - cur.width) / 2) + area.x;
        }
    }

    // 移動方向と直交する軸が作業領域以上のサイズなら、その軸は作業領域いっぱいに
    // 合わせる。
    if (horizontal) {
        if (cur.height >= area.height) {
            r.height = area.height;
            r.y = area.y;
        }
    } else {
        if (cur.width >= area.width) {
            r.width = area.width;
            r.x = area.x;
        }
    }

    return r;
}

function calcTargetRect(actionName, win, area, cfg) {
    if (FRACTION_ACTIONS.hasOwnProperty(actionName)) {
        return calcFractionRect(FRACTION_ACTIONS[actionName], area);
    }
    if (actionName === "Maximize") { return calcMaximize(win, area); }
    if (actionName === "MaximizeHeight") { return calcMaximizeHeight(win, area); }
    if (actionName === "AlmostMaximize") { return calcAlmostMaximize(win, area, cfg); }
    if (actionName === "Center") { return calcCenter(win, area); }
    if (actionName === "MakeLarger") { return calcChangeSize(win, area, cfg, true); }
    if (actionName === "MakeSmaller") { return calcChangeSize(win, area, cfg, false); }
    if (actionName === "MoveLeft") { return calcMove(win, area, cfg, "left"); }
    if (actionName === "MoveRight") { return calcMove(win, area, cfg, "right"); }
    if (actionName === "MoveTop") { return calcMove(win, area, cfg, "top"); }
    if (actionName === "MoveBottom") { return calcMove(win, area, cfg, "bottom"); }
    return null;
}

/* ========================================================================
 * 7. ウィンドウ間 gap の適用
 * ==================================================================== */

// 本家 gapsApplicable の移植。半分 / 1/4 / 1/3 系 / 1/6 は両方向、Maximize は
// 設定次第、MaximizeHeight は縦のみ、それ以外は適用しない。
function getGapAxes(actionName, cfg) {
    if (FRACTION_ACTIONS.hasOwnProperty(actionName)) {
        return { horizontal: true, vertical: true };
    }
    if (actionName === "Maximize") {
        return { horizontal: cfg.applyGapsToMaximize, vertical: cfg.applyGapsToMaximize };
    }
    if (actionName === "MaximizeHeight") {
        return { horizontal: false, vertical: true };
    }
    return { horizontal: false, vertical: false };
}

// 本家 GapCalculation.applyGaps の移植（DESIGN.md §5.3）。共有辺は視覚的な
// 向きで解釈するため、そのまま sharedEdges の文字列比較で判定できる。
function applyGaps(rect, actionName, cfg) {
    if (cfg.gapSize <= 0) {
        return rect;
    }
    var axes = getGapAxes(actionName, cfg);
    if (!axes.horizontal && !axes.vertical) {
        return rect;
    }

    var r = cloneRect(rect);
    var half = cfg.gapSize / 2;
    var spec = FRACTION_ACTIONS[actionName];
    var shared = spec ? spec.sharedEdges : [];

    if (axes.horizontal) {
        r.x += cfg.gapSize;
        r.width -= cfg.gapSize * 2;
        if (shared.indexOf("left") !== -1) { r.x -= half; r.width += half; }
        if (shared.indexOf("right") !== -1) { r.width += half; }
    }
    if (axes.vertical) {
        r.y += cfg.gapSize;
        r.height -= cfg.gapSize * 2;
        if (shared.indexOf("top") !== -1) { r.y -= half; r.height += half; }
        if (shared.indexOf("bottom") !== -1) { r.height += half; }
    }

    return r;
}

/* ========================================================================
 * 8. 制約とクランプ
 * ==================================================================== */

function fitRect(rect, win, area) {
    var r = cloneRect(rect);

    // 1. 整数化
    r.x = Math.round(r.x);
    r.y = Math.round(r.y);
    r.width = Math.round(r.width);
    r.height = Math.round(r.height);

    if (!win.resizeable) {
        // 2'. サイズ変更できないウィンドウは、現在のサイズのまま目標矩形の
        //     中央へ寄せる（本家 FixedSizeWindowMover 相当）。サイズを書き
        //     換えても KWin 側で拒否されるため、位置だけを意味のある値にする。
        var cur = win.frameGeometry;
        r.x = Math.round(r.x + (r.width - cur.width) / 2);
        r.y = Math.round(r.y + (r.height - cur.height) / 2);
        r.width = cur.width;
        r.height = cur.height;
    } else {
        // 2. minSize を下回るなら引き上げ
        var minSize = win.minSize;
        if (minSize) {
            if (r.width < minSize.width) { r.width = minSize.width; }
            if (r.height < minSize.height) { r.height = minSize.height; }
        }

        // 3. area を超えたら area に合わせる
        if (r.width > area.width) { r.width = Math.round(area.width); }
        if (r.height > area.height) { r.height = Math.round(area.height); }
    }

    // 4. 位置をクランプして作業領域からはみ出さないようにする
    r.x = clamp(r.x, area.x, area.x + area.width - r.width);
    r.y = clamp(r.y, area.y, area.y + area.height - r.height);

    return r;
}

/* ========================================================================
 * 9. 履歴管理（Phase 1 は Restore のためだけに使うが、Phase 2 の循環が
 *    そのまま乗る形にしておく。DESIGN.md §6）
 * ==================================================================== */

var restoreGeometry = {}; // id -> Rectangle 操作を受ける前のジオメトリ
var lastAction = {};      // id -> { action, rect, count }

// 注意（非同期性）: window.frameGeometry への書き込み直後に読み戻しては
// ならない（古い値が返る）ため、記録するのは常に「書き込んだ目標矩形」
// および「書き込み前に読んだジオメトリ」であり、書き込み後の再読み込みは
// 一切行わない。
function recordHistory(id, actionName, preRect, writtenRect) {
    var la = lastAction[id];
    var count;

    if (la && rectsNearlyEqual(preRect, la.rect, 2)) {
        // Rectangle が置いた場所からまだ動いていない。
        count = (la.action === actionName) ? la.count + 1 : 1;
    } else {
        // ユーザーが手で動かした、あるいは他が動かした。
        delete lastAction[id];
        restoreGeometry[id] = cloneRect(preRect);
        count = 1;
    }

    if (!restoreGeometry.hasOwnProperty(id)) {
        restoreGeometry[id] = cloneRect(preRect);
    }

    lastAction[id] = { action: actionName, rect: cloneRect(writtenRect), count: count };
}

function forgetHistory(id) {
    delete restoreGeometry[id];
    delete lastAction[id];
}

/* ========================================================================
 * 10. メインパイプライン
 * ==================================================================== */

// DESIGN.md §5 のアクション名一覧（説明はショートカット登録用）。
var ACTION_LIST = [
    ["LeftHalf", "左半分"],
    ["RightHalf", "右半分"],
    ["CenterHalf", "中央半分（幅 1/2）"],
    ["TopHalf", "上半分"],
    ["BottomHalf", "下半分"],
    ["TopLeft", "左上 1/4"],
    ["TopRight", "右上 1/4"],
    ["BottomLeft", "左下 1/4"],
    ["BottomRight", "右下 1/4"],
    ["FirstThird", "左 1/3"],
    ["CenterThird", "中央 1/3"],
    ["LastThird", "右 1/3"],
    ["FirstTwoThirds", "左 2/3"],
    ["LastTwoThirds", "右 2/3"],
    ["TopLeftSixth", "左上 1/6"],
    ["TopCenterSixth", "中央上 1/6"],
    ["TopRightSixth", "右上 1/6"],
    ["BottomLeftSixth", "左下 1/6"],
    ["BottomCenterSixth", "中央下 1/6"],
    ["BottomRightSixth", "右下 1/6"],
    ["Maximize", "最大化"],
    ["MaximizeHeight", "高さのみ最大化"],
    ["AlmostMaximize", "ほぼ最大化"],
    ["Center", "中央寄せ"],
    ["Restore", "元に戻す"],
    ["MakeLarger", "拡大"],
    ["MakeSmaller", "縮小"],
    ["MoveLeft", "左端へ寄せる"],
    ["MoveRight", "右端へ寄せる"],
    ["MoveTop", "上端へ寄せる"],
    ["MoveBottom", "下端へ寄せる"]
];

// Restore は「記録済みの復元用ジオメトリへ戻す」だけの特殊アクションであり、
// §6 の一般的な記録規則（recordHistory）ではなく専用の後始末を行う。
function executeRestore(win, id, cfg) {
    if (!restoreGeometry.hasOwnProperty(id)) {
        log("Restore: 復元対象のジオメトリが記録されていません (id=" + id + ")");
        return;
    }

    var area = getWorkArea(win, cfg);
    var target = fitRect(restoreGeometry[id], win, area);

    unsnap(win);
    win.frameGeometry = target;

    forgetHistory(id);
    log("Restore 実行: " + JSON.stringify(target));
}

// Maximize は KWin の最大化状態にする（タイトルバーのボタンと同じ挙動）。
// ただし gap を効かせる設定のときは最大化状態では隙間を作れないため、
// 従来どおり作業領域いっぱいのジオメトリ書き込みにフォールバックする。
function canNativeMaximize(win, cfg) {
    if (!win.maximizable) { return false; }
    if (cfg.screenEdgeGapTop !== 0 || cfg.screenEdgeGapBottom !== 0 ||
        cfg.screenEdgeGapLeft !== 0 || cfg.screenEdgeGapRight !== 0) {
        return false;
    }
    if (cfg.applyGapsToMaximize && cfg.gapSize > 0) { return false; }
    return true;
}

function execute(actionName) {
    try {
        var win = getTargetWindow();
        if (!win) {
            return;
        }

        var id = String(win.internalId);
        var cfg = loadConfig();

        if (actionName === "Restore") {
            executeRestore(win, id, cfg);
            return;
        }

        // 書き込み前のジオメトリを退避する（unsnap / 書き込みで変化する前の
        // 値。§6 の履歴比較・記録に使う）。
        var preRect = cloneRect(win.frameGeometry);

        var area = getWorkArea(win, cfg);
        var rect = calcTargetRect(actionName, win, area, cfg);
        if (!rect) {
            log("未知のアクション: " + actionName);
            return;
        }

        if (actionName === "Maximize" && canNativeMaximize(win, cfg)) {
            unsnap(win);
            win.setMaximize(true, true);
            // 最大化後のジオメトリは作業領域そのもの（gap 無しが前提）。
            recordHistory(id, actionName, preRect, area);
            log("Maximize 実行（ネイティブ最大化）");
            return;
        }

        rect = applyGaps(rect, actionName, cfg);
        rect = fitRect(rect, win, area);

        unsnap(win);
        win.frameGeometry = rect;

        recordHistory(id, actionName, preRect, rect);

        log(actionName + " 実行: " + JSON.stringify(rect));
    } catch (e) {
        console.info("rectangle-kwin: エラー (" + actionName + "): " + e);
    }
}

/* ========================================================================
 * 11. ショートカット登録 + windowRemoved フック
 * ==================================================================== */

for (var i = 0; i < ACTION_LIST.length; i++) {
    // var はブロックスコープを持たないため、actionName を IIFE で捕捉する。
    (function (actionName, description) {
        registerShortcut(
            "Rectangle: " + actionName,
            "Rectangle: " + description,
            "",
            function () { execute(actionName); }
        );
    })(ACTION_LIST[i][0], ACTION_LIST[i][1]);
}

// ウィンドウが閉じられたら履歴のリークを防ぐため両マップから削除する。
workspace.windowRemoved.connect(function (win) {
    try {
        forgetHistory(String(win.internalId));
    } catch (e) {
        console.info("rectangle-kwin: windowRemoved 処理でエラー: " + e);
    }
});
