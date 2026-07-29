#!/usr/bin/env bash
# Rectangle for KWin のインストールスクリプト。
# package/ を ~/.local/share/kwin/scripts/rectangle/ へ配置する。
# 既にインストール済みの場合は中身を更新する（アップグレード）。
#
# インストール後、KWin へスクリプトを認識させるには plasmashell / kwin の
# 再起動、またはログアウト・ログインが必要な場合がある。開発中の再読込は
# scripts/reload.sh を使うこと。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SOURCE_DIR="${PROJECT_ROOT}/package"
DEST_DIR="${HOME}/.local/share/kwin/scripts/rectangle"

if [ ! -d "${SOURCE_DIR}" ]; then
    echo "エラー: ${SOURCE_DIR} が見つかりません" >&2
    exit 1
fi

if command -v kpackagetool6 >/dev/null 2>&1; then
    echo "kpackagetool6 でインストールします..."
    if kpackagetool6 --type KWin/Script --show rectangle >/dev/null 2>&1; then
        kpackagetool6 --type KWin/Script --upgrade "${SOURCE_DIR}"
    else
        kpackagetool6 --type KWin/Script --install "${SOURCE_DIR}"
    fi
else
    echo "kpackagetool6 が見つからないため cp -r でインストールします..."
    mkdir -p "$(dirname "${DEST_DIR}")"
    rm -rf "${DEST_DIR}"
    cp -r "${SOURCE_DIR}" "${DEST_DIR}"
fi

cat <<'EOS'

インストールが完了しました。次の手順で有効化してください:

  1. システム設定 → ウィンドウ管理 → KWin スクリプト を開く
  2. "Rectangle" を探してチェックを入れる
  3. システム設定 → キーボード → ショートカット → KWin で
     "Rectangle" を検索し、必要なアクションにキーを割り当てる

反映されない場合はログアウト・ログインするか、開発用に
scripts/reload.sh の内容を確認のうえ手動で実行してください。
EOS
