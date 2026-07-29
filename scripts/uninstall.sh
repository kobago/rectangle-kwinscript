#!/usr/bin/env bash
# Rectangle for KWin のアンインストールスクリプト。install.sh の逆操作。
set -euo pipefail

DEST_DIR="${HOME}/.local/share/kwin/scripts/rectangle"

if command -v kpackagetool6 >/dev/null 2>&1 && kpackagetool6 --type KWin/Script --show rectangle >/dev/null 2>&1; then
    echo "kpackagetool6 でアンインストールします..."
    kpackagetool6 --type KWin/Script --remove rectangle
elif [ -d "${DEST_DIR}" ]; then
    echo "cp -r で導入されたディレクトリを削除します: ${DEST_DIR}"
    rm -rf "${DEST_DIR}"
else
    echo "Rectangle はインストールされていないようです（何もしません）"
fi

cat <<'EOS'

アンインストールが完了しました。有効化されていた場合は、システム設定の
KWin スクリプト一覧から消えていることを確認してください。反映されない
場合はログアウト・ログインが必要な場合があります。
EOS
