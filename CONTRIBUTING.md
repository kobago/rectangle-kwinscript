# 開発の進め方

## コミットメッセージ

[Conventional Commits](https://www.conventionalcommits.org/ja/v1.0.0/) に準拠する。

```
<type>(<scope>): <日本語の説明>

<本文（任意）>

<フッタ（任意）>
```

型（type）とスコープ（scope）は英語、説明と本文は日本語で書く。
`CHANGELOG.md` の自動生成とバージョン決定に使うため、型は必ず付ける。

### 型

| 型 | 用途 | バージョンへの影響 |
|---|---|---|
| `feat` | アクションや設定項目の追加 | マイナー |
| `fix` | 不具合の修正 | パッチ |
| `perf` | 性能改善 | パッチ |
| `refactor` | 挙動を変えない内部整理 | なし |
| `docs` | ドキュメントのみの変更 | なし |
| `test` | テストのみの変更 | なし |
| `build` | インストールスクリプト、パッケージ構成 | なし |
| `ci` | GitHub Actions などの設定 | なし |
| `chore` | 上記に当てはまらない雑務、リリース作業 | なし |

破壊的変更（既存のショートカット名の変更、設定キーの削除など）は
フッタに `BREAKING CHANGE: 内容` を書く。メジャーバージョンが上がる。

### スコープ

| スコープ | 対象 |
|---|---|
| `actions` | ウィンドウ配置アクションの追加・変更 |
| `geometry` | 座標計算、gap、クランプ、作業領域 |
| `shortcuts` | ショートカット登録まわり |
| `history` | 履歴管理、Restore、循環 |
| `config` | 設定キー、`main.xml`、設定 UI |
| `design` | `docs/DESIGN.md` |
| `release` | バージョン更新、タグ |

該当しない場合はスコープを省略してよい。

### 例

```
feat(actions): 1/16 分割 16 アクションを追加
fix(geometry): Quick Tile 済みウィンドウで書き込みが無視される問題を修正
docs(design): Phase 計画を更新
test(geometry): 分数計算の検証を 62 アクション分に拡張
chore(release): v0.2.0
```

## コミットの粒度

**機能ごとに 1 コミット。** 「Phase 2 を実装」のようなまとめ方はしない。

例として Phase 2（62 アクション）は次のように分割する。

```
feat(actions): 1/4・3/4 の縦割り 7 アクションを追加
feat(actions): 縦方向の 1/3・2/3 5 アクションを追加
feat(actions): 四隅の 1/3 4 アクションを追加
feat(actions): 中央 2/3 を追加
feat(actions): 1/8 分割 8 アクションを追加
feat(actions): 1/9 分割 9 アクションを追加
feat(actions): 1/12 分割 12 アクションを追加
feat(actions): 1/16 分割 16 アクションを追加
```

こうしておくと「1/16 だけ座標がおかしい」というときに該当コミットだけ戻せる。

**各コミットでテストが通る状態を保つ。** アクションを追加するコミットには、
そのアクションの検証も同じコミットに含める。

## テスト

コミット前に必ず実行する。KWin の API をスタブして Node.js 上で動くので、
実行中の KWin には影響しない。

```sh
node test/geometry-test.js
node test/history-test.js
node --check package/contents/code/main.js
```

## リリース

1. Phase の完了時にバージョンを決める（`feat` があればマイナー、`fix` のみならパッチ）
2. `package/metadata.json` の `KPlugin.Version` を更新する
3. `git-cliff --tag vX.Y.Z -o CHANGELOG.md` で変更履歴を生成する
4. `chore(release): vX.Y.Z` でコミットし、`git tag vX.Y.Z` を打つ

`git-cliff` の設定は `cliff.toml` にある。未インストールの場合は
`cargo install git-cliff` か AUR の `git-cliff` で入れる。

| バージョン | 内容 |
|---|---|
| `v0.1.0` | Phase 1（31 アクション） |
| `v0.2.0` | Phase 2（+62 アクション、計 93）予定 |

## 実装上の注意

KWin スクリプト特有の落とし穴は [`docs/DESIGN.md` §2](docs/DESIGN.md) にまとめてある。
特に以下は必ず読むこと。

- ジオメトリ書き込み前の `tile` / `maximize` / `fullScreen` 解除
- `frameGeometry` への書き込みが非同期であること
- `Qt` グローバルと `setTimeout` が存在しないこと
- 座標系が左上原点であること（本家は左下原点）
