# Rectangle for KWin — 設計書

macOS の [Rectangle](https://github.com/rxhanson/Rectangle) (MIT) を KWin スクリプトへ移植する。
本書は実装の仕様書であり、Phase 1 の範囲を確定させる。

対象環境: KWin 6.7.3 / Plasma 6.7.3 / Wayland（実機検証済み）

---

## 1. 方針

- **キーボードショートカット主体**。ドラッグスナップとプレビュー枠は実装しない（対象外）。
- Rectangle の特徴である**同じキーの連打によるサイズ循環**（½ → ⅔ → ⅓）を最終目標とする。
  Phase 1 では循環を入れないが、**Phase 2 で差分追加できる構造**にしておく（§6 の履歴管理）。
- 数値・端数処理は可能な限り Rectangle 本家の計算式に合わせる（移植であり再発明ではない）。

---

## 2. KWin API の前提（実機検証済み）

| 用途 | API | 備考 |
|---|---|---|
| ウィンドウ取得 | `workspace.activeWindow` | |
| ジオメトリ | `window.frameGeometry` (read/write) | **書き込みは非同期**。同一 tick 内の読み戻しは古い値 |
| 作業領域 | `workspace.clientArea(KWin.MaximizeArea, output, desktop)` | パネル除外済み |
| 画面全体 | `workspace.clientArea(KWin.FullArea, output, desktop)` | |
| ショートカット | `registerShortcut(name, description, seq, callback)` | `[kwin]` グループに登録。システム設定から編集可 |
| 設定読み込み | `readConfig(key, default)` | 型付きで返る |
| ウィンドウ識別 | `window.internalId` (UUID) | 履歴のキー |
| 制約 | `window.minSize`, `maxSize`, `resizeable`, `moveable` | |
| タイマー | `new QTimer()` | `setTimeout` は**存在しない** |

### 環境上の制約（実装時の必須注意）

1. **`Qt` グローバルは存在しない。** `Qt.rect()` は使えない。矩形はプレーンオブジェクト
   `{ x, y, width, height }` を渡す（動作確認済み）。
2. **`setTimeout` / `setInterval` は存在しない。** 必要なら `new QTimer()`。
3. **ジオメトリ書き込み前に必ずタイル状態を解除すること。**
   ```js
   if (w.fullScreen) w.fullScreen = false;
   w.setMaximize(false, false);
   w.tile = null;              // ← これが無いと書き込みが無視される
   ```
   前回の試作（ゴミ箱の `rectangle.kwinscript`）はこれが無く、Quick Tile 済みウィンドウで
   動作しなかった。**最重要の落とし穴。**
4. **座標系は左上原点・y 下向き。** Rectangle 側の計算式は左下原点（`screenFlipped`）で
   書かれているため、**y 方向は反転して読み替える**こと。
   例: Rectangle の `origin.y = maxY - height`（＝視覚的な上端）は KWin では `y = area.y`。
5. アプリ側のリサイズ増分・最小サイズで指定どおりにならない場合がある
   （実測: Chrome に 913 を指定 → 913.333）。Phase 1 では許容し、はみ出し防止のクランプのみ行う。
6. `KWin.MaximizeArea` 等の定数は存在するが列挙不可。実測値:
   `PlacementArea=0`, `MaximizeArea=2`, `WorkArea=5`, `FullArea=6`, `ScreenArea=7`。

---

## 3. 成果物のレイアウト

```
rectangle-kwinscript/
├── README.md
├── LICENSE                       # MIT（Rectangle からの移植である旨を明記）
├── docs/DESIGN.md                # 本書
├── package/
│   ├── metadata.json
│   └── contents/
│       ├── code/main.js          # 実装本体（単一ファイル）
│       └── config/main.xml       # 設定キー定義
└── scripts/
    ├── install.sh                # ~/.local/share/kwin/scripts/ へ導入
    ├── uninstall.sh
    └── reload.sh                 # 開発用: qdbus で unload → load（ログアウト不要）
```

**`main.js` は単一ファイル**とする。KWin のスクリプトサンドボックスには `require` / `import` が
無く、複数ファイルを読み込めないため。セクション区切りコメントで構造を明示する。
（後続 Phase で肥大化したら concat のビルド手順を追加する。）

設定 UI (`contents/ui/config.ui`) は Phase 1 では**作らない**。`readConfig` は
`main.xml` の既定値を返すため動作に支障はない。

---

## 4. アクション一覧（Phase 1 の範囲）

ユーザーの `~/.config/kglobalshortcutsrc` の `[kwin]` グループには、前回の試作が登録した
`Rectangle: *` という名前のショートカットが**割り当て済みのまま残っている**。
**同一の名前で `registerShortcut` すれば既存の割り当てがそのまま引き継がれる**ため、
名前は下表のとおり厳密に一致させること（`Rectangle: ` の後の空白を含む）。

`registerShortcut` の第3引数（既定キー）は **`""`（空文字）** を渡す。
既存の割り当てを尊重し、未割り当てのものはユーザーがシステム設定で決められるようにするため。

比率は**作業領域に対する割合**、座標は**左上原点**。

### 4.1 半分

| shortcut name | 説明 | x | y | w | h | 共有辺 |
|---|---|---|---|---|---|---|
| `Rectangle: LeftHalf` | 左半分 | 0 | 0 | 1/2 | 1 | right |
| `Rectangle: RightHalf` | 右半分 | 1/2 | 0 | 1/2 | 1 | left |
| `Rectangle: CenterHalf` | 中央半分（幅 1/2） | 1/4 | 0 | 1/2 | 1 | なし |
| `Rectangle: TopHalf` | 上半分 | 0 | 0 | 1 | 1/2 | bottom |
| `Rectangle: BottomHalf` | 下半分 | 0 | 1/2 | 1 | 1/2 | top |

> `CenterHalf` は本家 `centerHalf` の移植。既存のショートカット割り当てには
> 無かったため後から追加した（キーは未割り当て）。左右どちらの端とも接しない
> ので共有辺は持たず、gap は四方に均等に入る。
> 縦長ディスプレイでは本家は「高さ 1/2・幅いっぱい」に切り替わるが、
> 1/6 と同様に Phase 1 では横長レイアウト固定とする。

### 4.2 1/4（四隅）

| shortcut name | 説明 | x | y | w | h | 共有辺 |
|---|---|---|---|---|---|---|
| `Rectangle: TopLeft` | 左上 1/4 | 0 | 0 | 1/2 | 1/2 | bottom, right |
| `Rectangle: TopRight` | 右上 1/4 | 1/2 | 0 | 1/2 | 1/2 | bottom, left |
| `Rectangle: BottomLeft` | 左下 1/4 | 0 | 1/2 | 1/2 | 1/2 | top, right |
| `Rectangle: BottomRight` | 右下 1/4 | 1/2 | 1/2 | 1/2 | 1/2 | top, left |

### 4.3 1/3 系

| shortcut name | 説明 | x | y | w | h | 共有辺 |
|---|---|---|---|---|---|---|
| `Rectangle: FirstThird` | 左 1/3 | 0 | 0 | 1/3 | 1 | なし |
| `Rectangle: CenterThird` | 中央 1/3 | 1/3 | 0 | 1/3 | 1 | なし |
| `Rectangle: LastThird` | 右 1/3 | 2/3 | 0 | 1/3 | 1 | なし |
| `Rectangle: FirstTwoThirds` | 左 2/3 | 0 | 0 | 2/3 | 1 | なし |
| `Rectangle: LastTwoThirds` | 右 2/3 | 1/3 | 0 | 2/3 | 1 | なし |

> 1/3 系の共有辺が「なし」なのは Rectangle 本家の挙動そのまま（`WindowAction.gapSharedEdge`
> は half と corner にしか共有辺を定義していない）。結果として隣接する 1/3 同士の間隔は
> gap の 2 倍になる。**本家準拠のため意図的にこの挙動を再現する。**

### 4.4 1/6（横長ディスプレイ: 3列 × 2行）

| shortcut name | 説明 | x | y | w | h |
|---|---|---|---|---|---|
| `Rectangle: TopLeftSixth` | 左上 1/6 | 0 | 0 | 1/3 | 1/2 |
| `Rectangle: TopCenterSixth` | 中央上 1/6 | 1/3 | 0 | 1/3 | 1/2 |
| `Rectangle: TopRightSixth` | 右上 1/6 | 2/3 | 0 | 1/3 | 1/2 |
| `Rectangle: BottomLeftSixth` | 左下 1/6 | 0 | 1/2 | 1/3 | 1/2 |
| `Rectangle: BottomCenterSixth` | 中央下 1/6 | 1/3 | 1/2 | 1/3 | 1/2 |
| `Rectangle: BottomRightSixth` | 右下 1/6 | 2/3 | 1/2 | 1/3 | 1/2 |

共有辺は「なし」（本家準拠）。
縦長ディスプレイ時の 2列×3行 レイアウト（本家 `OrientationAware`）は **Phase 1 では未対応**。

### 4.5 特殊アクション

いずれも上記の比率テーブルでは表現できず、個別のロジックが必要。

| shortcut name | 説明 | ロジック | gap |
|---|---|---|---|
| `Rectangle: Maximize` | 最大化 | 作業領域いっぱい | 両方向<br>（`applyGapsToMaximize` が false なら無し） |
| `Rectangle: MaximizeHeight` | 高さのみ最大化 | x, width は維持。`y = area.y`, `height = area.height` | 縦方向のみ |
| `Rectangle: AlmostMaximize` | ほぼ最大化 | `w = round(area.w * 0.9)`, `h = round(area.h * 0.9)` を中央寄せ | 無し |
| `Rectangle: Center` | 中央寄せ | サイズ維持のまま中央へ。§4.6 参照 | 無し |
| `Rectangle: Restore` | 元に戻す | 記録済みの復元用ジオメトリへ戻す。§6 参照 | 無し |
| `Rectangle: MakeLarger` | 拡大 | §4.7 | 無し |
| `Rectangle: MakeSmaller` | 縮小 | §4.7 | 無し |
| `Rectangle: MoveLeft` | 左端へ寄せる | §4.8 | 無し |
| `Rectangle: MoveRight` | 右端へ寄せる | §4.8 | 無し |
| `Rectangle: MoveTop` | 上端へ寄せる | §4.8 | 無し |
| `Rectangle: MoveBottom` | 下端へ寄せる | §4.8 | 無し |

### 4.6 Center

本家 `CenterCalculation` の移植（y 反転済み）:

```
heightExceeded = win.height > area.height
widthExceeded  = win.width  > area.width

if (heightExceeded && widthExceeded) → 作業領域いっぱい（= Maximize と同結果）

height: heightExceeded ? (h = area.height, y = area.y)
                       : y = round((area.height - win.height) / 2) + area.y
width : widthExceeded  ? (w = area.width,  x = area.x)
                       : x = round((area.width  - win.width ) / 2) + area.x
```

### 4.7 MakeLarger / MakeSmaller

本家 `ChangeSizeCalculation` の移植。`sizeOffset` は拡大が `+sizeOffset`、縮小が `-sizeOffset`
（既定 30）。幅・高さの両方に適用する。

```
r = 現在のジオメトリのコピー

# 幅
r.width += sizeOffset
r.x     -= floor(sizeOffset / 2)
if (curtainChangeSize) r = 左右の画面端に吸着させる補正   # 下記
if (r.width >= area.width) r.width = area.width

# 高さ
r.height += sizeOffset
r.y      -= floor(sizeOffset / 2)
if (curtainChangeSize) r = 上下の画面端に吸着させる補正
if (r.height >= area.height) { r.height = area.height; r.y = 現在の y }

# 四辺すべてが画面端に接していて縮小する場合は、元の矩形を基準に対称に縮める
if (四辺すべて接している && sizeOffset < 0) 元の矩形から対称に ±sizeOffset

# 縮小しすぎたら何もしない
if (縮小 && 小さすぎる) r = 元の矩形
```

補助定義（本家準拠）:

- `screenEdgeGapSize = (gapSize <= 0) ? 5 : gapSize` — 「画面端に接している」の判定閾値
- 「接している」= 該当辺と作業領域の該当辺との差の絶対値が `screenEdgeGapSize` 以下
- 「小さすぎる」= `minimumWindowWidth` / `minimumWindowHeight` を下回る（既定はどちらも 0
  なので実質無効。設定キーとしては用意する）

**カーテン補正（左右）** — 元の矩形がどちらの画面端に接していたかで、リサイズ後の位置を決める:

```
if (元が右端に接していた):
    r.x = area.right - r.width - gapSize
    if (元が左端にも接していた):        # 画面幅いっぱいだった
        r.width = area.width - gapSize * 2
if (元が左端に接していた):
    r.x = area.left + gapSize
```

上下も同様（`MakeSmaller` の高さ方向のみ本家はカーテン補正を適用しない点に注意
— 本家の条件は `curtainChangeSize && action != .smallerHeight`。
Phase 1 には `smallerHeight` 単体アクションが無いため、高さ方向のカーテン補正は
`MakeLarger` / `MakeSmaller` の両方で適用してよい）。

### 4.8 Move 系

本家 `MoveLeftRightCalculation` / `MoveUpDownCalculation` の移植。
`resizeOnDirectionalMove` は既定 false なので**サイズは変更しない**。

```
MoveLeft  : x = area.x
MoveRight : x = area.x + area.width - win.width
MoveTop   : y = area.y
MoveBottom: y = area.y + area.height - win.height

if (centeredDirectionalMove)        # 既定 true
    MoveLeft/MoveRight : y = round((area.height - win.height) / 2) + area.y
    MoveTop/MoveBottom : x = round((area.width  - win.width ) / 2) + area.x

# 片方の軸が作業領域以上なら、その軸は作業領域いっぱいに合わせる
MoveLeft/MoveRight : if (win.height >= area.height) { height = area.height; y = area.y }
MoveTop/MoveBottom : if (win.width  >= area.width ) { width  = area.width;  x = area.x }
```

---

## 5. 計算パイプライン

1 アクション実行時の流れ。**この順序を守ること。**

```
1. 対象ウィンドウ取得        getTargetWindow()
2. 作業領域算出              getWorkArea(window)      ← 画面端 gap を反映
3. 目標矩形を計算            calc(action, window, area)
4. ウィンドウ間 gap を適用   applyGaps(rect, action)
5. 制約適用 + クランプ       fitRect(rect, window, area)
6. タイル状態解除            unsnap(window)
7. 書き込み                  window.frameGeometry = rect
8. 履歴記録                  recordAction(...)
```

### 5.1 対象ウィンドウの判定 `getTargetWindow()`

以下をすべて満たすもののみ対象。満たさない場合は何もせず `return`（エラーにしない）。

```js
w = workspace.activeWindow
w != null && w.normalWindow && w.moveable && !w.minimized
```

`resizeable` は条件に**含めない**。固定サイズのダイアログ等でも移動はできるため、
除外すると `Center` や `Move` 系が一切効かなくなる。サイズの扱いは §5.4 で分岐する。

### 5.2 作業領域 `getWorkArea(window)`

```js
desktop = window.desktops.length > 0 ? window.desktops[0] : workspace.currentDesktop
area    = workspace.clientArea(KWin.MaximizeArea, window.output, desktop)
```

そこから画面端 gap を差し引く（本家 `adjustedVisibleFrame` 相当、y 反転済み）:

```
area.x      += screenEdgeGapLeft
area.width  -= (screenEdgeGapLeft + screenEdgeGapRight)
area.y      += screenEdgeGapTop
area.height -= (screenEdgeGapTop + screenEdgeGapBottom)
```

戻り値は必ず**新しいプレーンオブジェクト**にすること（`clientArea` の戻り値を直接書き換えない）。

### 5.3 ウィンドウ間 gap `applyGaps(rect, action)`

本家 `GapCalculation.applyGaps` の移植。`gapSize <= 0` または対象アクションが gap 非適用なら
何もしない。共有辺は**視覚的な向き**で解釈する（本家の `Edge` も視覚基準なのでそのまま使える）。

```
half = gapSize / 2

# まず全方向を gapSize だけ内側に縮める（適用対象の軸のみ）
if (horizontal 適用) { rect.x += gapSize; rect.width  -= gapSize * 2 }
if (vertical   適用) { rect.y += gapSize; rect.height -= gapSize * 2 }

# 共有辺は半分だけ戻す
if (horizontal 適用):
    if (共有辺に left)  { rect.x -= half; rect.width  += half }
    if (共有辺に right) {                 rect.width  += half }
if (vertical 適用):
    if (共有辺に top)   { rect.y -= half; rect.height += half }
    if (共有辺に bottom){                 rect.height += half }
```

gap 適用の軸（本家 `gapsApplicable`）:

- 半分 / 1/4 / 1/3 系 / 1/6 → **両方向**
- `Maximize` → `applyGapsToMaximize` が true なら両方向、false なら無し
- `MaximizeHeight` → **縦方向のみ**
- それ以外（AlmostMaximize, Center, Restore, MakeLarger/Smaller, Move 系）→ **無し**

### 5.4 制約とクランプ `fitRect(rect, window, area)`

```
1. 座標・サイズを整数に丸める（Math.round）

2. サイズ変更の可否で分岐する
   window.resizeable が false（固定サイズのダイアログ等）:
       現在のサイズを維持したまま、目標矩形の中央へ寄せる
       （本家 FixedSizeWindowMover 相当。サイズを書き換えても KWin 側で
        拒否されるため、位置だけを意味のある値にする）
   window.resizeable が true:
       a. window.minSize を下回るなら width/height を引き上げる
       b. width/height が area を超えるなら area に合わせる

3. 位置をクランプして作業領域からはみ出さないようにする
   x = clamp(x, area.x, area.x + area.width  - width)
   y = clamp(y, area.y, area.y + area.height - height)
   （固定サイズでウィンドウが作業領域より大きい場合は max < min となるため、
     clamp は max を min に丸めて扱うこと）
```

> アプリのリサイズ増分で実際のサイズが目標とずれる件（§2-5）への追随（本家の
> `BestEffortWindowMover` 相当）は Phase 1 の範囲外。

---

## 6. 履歴管理

Phase 1 では `Restore` のためだけに使うが、**Phase 2 の循環がそのまま乗る形**にしておく。

`window.internalId`（UUID 文字列）をキーにした 2 つのマップを持つ。

```js
restoreGeometry = {}   // id -> Rectangle 操作を受ける前のジオメトリ
lastAction      = {}   // id -> { action: string, rect: {…}, count: number }
```

### 記録の規則

アクション実行時:

1. `lastAction[id]` があり、かつ**現在のジオメトリが `lastAction[id].rect` と一致する**
   （許容誤差 ±2px）なら「Rectangle が置いた場所からまだ動いていない」と見なす。
   - 同じアクションなら `count + 1`、違うアクションなら `count = 1`。
2. 一致しない場合（ユーザーが手で動かした / 他が動かした）:
   - `lastAction[id]` を破棄し、`restoreGeometry[id]` を**現在のジオメトリで更新**する。
3. `restoreGeometry[id]` が未設定なら現在のジオメトリを記録する。
4. 書き込み後、`lastAction[id] = { action, rect: 書き込んだ目標矩形, count }` を記録する。

> **注意（§2-1 の非同期性）:** 書き込み直後に `frameGeometry` を読み戻してはならない。
> 記録するのは「書き込んだ**目標**矩形」。次回実行時の比較も目標矩形に対して行う。
> 許容誤差 ±2px はリサイズ増分による微小なズレを吸収するため。

### `Restore` の動作

```
if (restoreGeometry[id] が存在):
    そのジオメトリへ戻す
    delete lastAction[id]
    delete restoreGeometry[id]
```

### 後始末

`workspace.windowRemoved` で該当 id のエントリを両マップから削除する（リーク防止）。

### Phase 2 への接続点

循環は `lastAction[id].count` を見て分数を選ぶだけで実装できる
（本家 `RepeatedExecutionsCalculation.calculateRepeatedRect` 相当）。
Phase 1 の時点で `count` を正しく育てておくことが条件。

---

## 7. 設定キー

`contents/config/main.xml` に定義し、`readConfig(key, default)` で読む。
**ショートカットの起動ごとに読み直す**こと（システム設定での変更を再起動なしに反映するため）。

| キー | 型 | 既定 | 説明 |
|---|---|---|---|
| `gapSize` | Double | 0 | ウィンドウ間 / 画面端の余白 |
| `screenEdgeGapTop` | Double | 0 | 作業領域の上端をさらに削る |
| `screenEdgeGapBottom` | Double | 0 | 同 下端 |
| `screenEdgeGapLeft` | Double | 0 | 同 左端 |
| `screenEdgeGapRight` | Double | 0 | 同 右端 |
| `applyGapsToMaximize` | Bool | true | 最大化に gap を適用するか |
| `almostMaximizeWidth` | Double | 0.9 | 「ほぼ最大化」の幅比率（0 < v <= 1 以外は 0.9 に丸める） |
| `almostMaximizeHeight` | Double | 0.9 | 同 高さ比率 |
| `sizeOffset` | Double | 30 | 拡大 / 縮小の 1 回あたりの変化量（0 以下なら 30） |
| `minimumWindowWidth` | Double | 0 | 縮小時の下限幅 |
| `minimumWindowHeight` | Double | 0 | 縮小時の下限高さ |
| `centeredDirectionalMove` | Bool | true | Move 系で他軸を中央寄せするか |
| `curtainChangeSize` | Bool | true | 拡大 / 縮小のカーテン補正 |
| `debug` | Bool | false | journalctl へのログ出力 |

---

## 8. ログ

```js
function log(msg) { if (config.debug) console.info("rectangle-kwin: " + msg); }
```

確認方法: `journalctl --user -b -f | grep rectangle-kwin`

`console.info` を使うこと（`print` は環境によって拾えない）。

---

## 9. Phase 1 の完了条件

- [ ] §4 の 30 アクションすべてが `registerShortcut` で登録され、システム設定に現れる
- [ ] 既存の `Rectangle: *` ショートカット割り当てがそのまま機能する
- [ ] Quick Tile 済み・最大化済みのウィンドウでも正しく配置される（`tile = null` 対応）
- [ ] マルチモニタ環境で、ウィンドウが載っているモニタの作業領域が使われる
- [ ] `Restore` で元のサイズに戻る
- [ ] gap を 8 などにすると余白が入る
- [ ] `install.sh` で導入、`reload.sh` で再読込できる

## 10. 全体ロードマップ

本家 Rectangle のアクションは全 **125** 個。Phase 1 で **31** 個を実装済み、残り **94** 個。

### 10.1 Phase 1 実装済み（31）

半分 4 + 中央半分 1 + 1/4 四隅 4 + 1/3 系 5 + 1/6 の 6 +
Maximize / MaximizeHeight / AlmostMaximize / Center / Restore /
MakeLarger / MakeSmaller / Move 4 方向 = 31。

詳細は §4 を参照。

### 10.2 方針

**本家のショートカットを再現することを最優先**とし、挙動の作り込み（サイズ循環など）は
後回しにする。したがって「分数テーブルへの行追加だけで済むアクション」をまとめて先に片付け、
新規ロジックが必要なものを後段に置く。

本家の各計算クラスを確認したところ、1/4・3/4 の縦割り / 縦方向 1/3 / 四隅 1/3 / 中央 2/3 /
1/8 / 1/9 / 1/12 / 1/16 の **62 個はすべて、横長画面での基本形が単純な分数配置**である
（循環ロジックは `lastAction` がある場合の分岐に閉じており、循環を実装しない限り
基本形だけで足りる）。よってこの 62 個は Phase 2 に一括で入れる。

### 10.3 未実装アクション（94）と割り当て Phase

| Phase | 内容 | 数 | 実装の性質 |
|---|---|---|---|
| **2** ([#1](https://github.com/kobago/rectangle-kwinscript/issues/1)) | 1/4・3/4 の縦割り (`firstFourth`, `secondFourth`, `thirdFourth`,<br>`lastFourth`, `firstThreeFourths`, `centerThreeFourths`, `lastThreeFourths`) | 7 | 分数テーブル追加 |
| **2** | 縦方向の 1/3・2/3 (`topVerticalThird`, `middleVerticalThird`,<br>`bottomVerticalThird`, `topVerticalTwoThirds`, `bottomVerticalTwoThirds`) | 5 | 分数テーブル追加 |
| **2** | 四隅の 1/3 (`topLeftThird`, `topRightThird`,<br>`bottomLeftThird`, `bottomRightThird`) | 4 | 分数テーブル追加 |
| **2** | 中央 2/3 (`centerTwoThirds`) | 1 | 分数テーブル追加 |
| **2** | 1/8 分割 | 8 | 分数テーブル追加 |
| **2** | 1/9 分割 | 9 | 分数テーブル追加 |
| **2** | 1/12 分割 | 12 | 分数テーブル追加 |
| **2** | 1/16 分割 | 16 | 分数テーブル追加 |
| **3** ([#2](https://github.com/kobago/rectangle-kwinscript/issues/2)) | 次 / 前のディスプレイへ移動 (`previousDisplay`, `nextDisplay`) | 2 | 新規ロジック |
| **3** | 特定ディスプレイへ移動 (`displayOne` … `displayNine`) | 9 | 新規ロジック |
| **4** ([#3](https://github.com/kobago/rectangle-kwinscript/issues/3)) | 幅 / 高さ個別の拡大縮小 (`largerWidth`, `smallerWidth`,<br>`largerHeight`, `smallerHeight`) | 4 | 新規ロジック |
| **4** | 倍 / 半分（方向指定） (`doubleHeightUp` … `halveWidthRight`) | 8 | 新規ロジック |
| **4** | サイズ指定 (`specified`)、目立たせて中央 (`centerProminently`) | 2 | 新規ロジック |
| **5** ([#4](https://github.com/kobago/rectangle-kwinscript/issues/4)) | 複数ウィンドウ整列 (`tileAll`, `cascadeAll`, `reverseAll`,<br>`tileActiveApp`, `cascadeActiveApp`) | 5 | 新規ロジック |
| **6** ([#5](https://github.com/kobago/rectangle-kwinscript/issues/5)) | 同じキー連打によるサイズ循環（½ → ⅔ → ⅓）<br>1/3 系・1/4 系の位置循環<br>モニタ跨ぎの連続実行 | 0 | 既存アクションの挙動変更 |
| **7** ([#6](https://github.com/kobago/rectangle-kwinscript/issues/6)) | リサイズ増分によるズレへの追随（本家 `BestEffortWindowMover` 相当）<br>縦長ディスプレイ対応（レイアウト切替）<br>アプリ別の無効化、設定 UI (`config.ui`) | 0 | 挙動変更・基盤 |
| **保留** ([#7](https://github.com/kobago/rectangle-kwinscript/issues/7)) | Todo モード (`leftTodo`, `rightTodo`) | 2 | 用途が限定的 |

合計 94。Phase 2 完了時点で **93 / 125** アクションに到達する。

Phase 6 のサイズ循環は Phase 1 の履歴管理（§6 の `lastAction.count`）の上に乗る。
実装を後回しにしても、`count` は Phase 1 の時点で正しく育てているため手戻りは無い。
既定で有効にするか無効にするかは着手時に判断する。

### 10.4 命名に関する注意

本家の名前が実際の形状と一致しないものがある。ラベルは実寸がわかる表記にする。

| 本家の名前 | 実際の形状（横長画面） |
|---|---|
| `topLeftThird` 等の「四隅の 1/3」 | 幅 **2/3** × 高さ 1/2。1/3 ではない |
| `topLeftEighth` 等の 1/8 | 幅 1/4 × 高さ 1/2（4 列 × 2 行） |
| `topLeftTwelfth` 等の 1/12 | 幅 1/4 × 高さ 1/3（4 列 × 3 行） |
| `topLeftSixteenth` 等の 1/16 | 幅 1/4 × 高さ 1/4（4 列 × 4 行） |

### 10.5 実装しない予定のもの

本家にあるが KWin へ移植する意味が薄い、あるいは KDE 側に同等機能があるもの:

- Stage Manager 連携（macOS 固有）
- 緑ボタンの上書き、タイトルバーのダブルクリック動作（KDE のウィンドウ操作設定で代替）
- メニューバーアイコン、URL スキーム、設定の JSON import / export
- ログイン時起動、自動更新

Todo モードは実装可能だが用途が限定的なため保留とする。必要になった時点で Phase を割り当てる。
