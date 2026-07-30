#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

bash "$PROJECT_DIR/scripts/install-launch-agent.sh"

for _ in {1..30}; do
  if curl --silent --fail http://127.0.0.1:3777/api/auth/status >/dev/null; then
    open http://127.0.0.1:3777/
    exit 0
  fi
  sleep 1
done

echo "服务未能在 30 秒内启动，请检查 logs/launchd.err.log。"
read -r -p "按回车键关闭窗口。"
exit 1
