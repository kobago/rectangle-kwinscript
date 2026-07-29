# Rectangle for KWin

macOS のウィンドウ管理ツール [Rectangle](https://github.com/rxhanson/Rectangle)（MIT License,
作者: Ryan Hanson）を KWin (KDE Plasma) スクリプトへ移植したものです。
ドラッグスナップやプレビュー枠は実装せず、**キーボードショートカットによる
ウィンドウ配置**のみに絞っています。

設計の詳細は [`docs/DESIGN.md`](docs/DESIGN.md) を参照してください。

## 動作要件

- KDE Plasma 6 / KWin 6
- Wayland（実機検証: KWin 6.7.3 / Plasma 6.7.3 / Wayland）
- X11 セッションでの動作は未検証です

## インストール

```sh
./scripts/install.sh
```

`kpackagetool6` が使える場合はそれで、無ければ
`~/.local/share/kwin/scripts/rectangle/` へ直接コピーします。

インストール後:

1. **システム設定 → ウィンドウ管理 → KWin スクリプト** を開き、
   "Rectangle" にチェックを入れて有効化する
2. **システム設定 → キーボード → ショートカット → KWin** で
   "Rectangle" を検索し、使いたいアクションにキーを割り当てる

本スクリプトは既定のキーを一切設定しません（空で登録します）。これは
`kglobalshortcutsrc` に既存の `Rectangle: *` 割り当てが残っている場合に、
それを上書きせず引き継ぐためです。過去に同名で登録していた環境では、
インストール後すぐに以前のキーがそのまま使えます。

反映されない場合はログアウト・ログインしてください。開発中の再読込には
`scripts/reload.sh` を使います（`qdbus6` で該当スクリプトを unload → load
するため、ログアウト不要です）。

アンインストールは:

```sh
./scripts/uninstall.sh
```

## アクション一覧

半分（上下左右＋中央半分）、1/4（四隅）、1/3 系（左/中央/右の 1/3、左右の 2/3）、
1/6（3 列 × 2 行）、最大化・高さのみ最大化・ほぼ最大化・中央寄せ・元に戻す・
拡大・縮小・上下左右への寄せ、の合計 31 アクションを提供します。
一覧とキー名の正確な対応は [`docs/DESIGN.md` §4](docs/DESIGN.md) を参照してください。

## 設定キー

`contents/config/main.xml` で定義されている設定です。Phase 1 には設定 UI が
無いため、必要であれば `kwriteconfig6` などで直接編集してください
（例: `kwriteconfig6 --file kwinrc --group Script-rectangle --key gapSize 8`）。

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

設定はショートカットの起動ごとに読み直すため、変更後にスクリプトを再読込
する必要はありません。

## テスト

KWin の API をスタブして Node.js 上で計算ロジックを検証できます。実行中の
KWin には触れないため、デスクトップを使いながら安全に実行できます。

```sh
node test/geometry-test.js   # 各アクションのジオメトリ計算
node test/history-test.js    # 履歴管理と Restore
```

## ログの確認方法

`debug` を `true` にしたうえで:

```sh
journalctl --user -b -f | grep rectangle-kwin
```

## 現在の制限（Phase 1 の範囲）

本家 Rectangle の全 125 アクションのうち、Phase 1 では 31 アクションを実装して
います。残り 94 アクションと以下の挙動は後続 Phase の対象です。
フェーズ割り当ての全体像は [`docs/DESIGN.md` §10](docs/DESIGN.md) を参照してください。

本家のショートカットを再現することを最優先とし、挙動の作り込み（サイズ循環など）は
後回しにする方針です。

| Phase | 内容 | アクション数 |
|---|---|---|
| [2](https://github.com/kobago/rectangle-kwinscript/issues/1) | 1/4・3/4 の縦割り、縦方向 1/3・2/3、四隅 1/3、中央 2/3、<br>1/8・1/9・1/12・1/16 分割 | 62 |
| [3](https://github.com/kobago/rectangle-kwinscript/issues/2) | 次 / 前・特定のディスプレイへの移動 | 11 |
| [4](https://github.com/kobago/rectangle-kwinscript/issues/3) | 幅 / 高さ個別の拡大縮小、倍 / 半分（方向指定）、サイズ指定 | 14 |
| [5](https://github.com/kobago/rectangle-kwinscript/issues/4) | tileAll / cascadeAll などの複数ウィンドウ整列 | 5 |
| [6](https://github.com/kobago/rectangle-kwinscript/issues/5) | 同じキーの連打によるサイズ循環（½ → ⅔ → ⅓）、位置循環 | 0 |
| [7](https://github.com/kobago/rectangle-kwinscript/issues/6) | リサイズ増分によるズレへの追随、縦長ディスプレイ対応、<br>アプリ別の無効化、設定 UI | 0 |
| [保留](https://github.com/kobago/rectangle-kwinscript/issues/7) | Todo モード | 2 |

Phase 2 は分数テーブルへの追加だけで済むため、完了時点で 93 / 125 アクションに
到達します。

## ライセンス

MIT License。[`LICENSE`](LICENSE) を参照してください。オリジナルの
[Rectangle](https://github.com/rxhanson/Rectangle)（作者: Ryan Hanson）から
の移植であることを明記しています。
