#!/usr/bin/env bash
# 開発用: ログアウトせずに Rectangle スクリプトを再読込する。
# org.kde.KWin の Scripting インターフェースを D-Bus 経由で叩き、
# unloadScript → loadScript → start する。
#
# 注意: このスクリプトは実行中の KWin に直接作用する。
# 変更内容をレビューしてから手動で実行すること。ここでは自動実行しない。
set -euo pipefail

PLUGIN_NAME="rectangle"
MAIN_JS="${HOME}/.local/share/kwin/scripts/rectangle/contents/code/main.js"

if [ ! -f "${MAIN_JS}" ]; then
    echo "エラー: ${MAIN_JS} が見つかりません。先に install.sh を実行してください" >&2
    exit 1
fi

echo "Rectangle スクリプトをアンロードします..."
qdbus6 org.kde.KWin /Scripting org.kde.kwin.Scripting.unloadScript "${PLUGIN_NAME}" || true

echo "Rectangle スクリプトをロードします..."
qdbus6 org.kde.KWin /Scripting org.kde.kwin.Scripting.loadScript "${MAIN_JS}" "${PLUGIN_NAME}"

echo "ロード済みスクリプトを起動します..."
qdbus6 org.kde.KWin /Scripting org.kde.kwin.Scripting.start

echo "完了。journalctl --user -b -f | grep rectangle-kwin でログを確認できます。"
