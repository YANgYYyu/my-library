#!/usr/bin/env bash
# 停止 Prompt & Skills 预览服务（端口固定 8001）。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=config.sh
source "$SCRIPT_DIR/config.sh"
PID_FILE="/tmp/my-library-server-$PORT.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "未找到 PID 文件，服务可能未通过 restart.sh 启动"
  exit 0
fi

PID="$(cat "$PID_FILE")"
if kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
  echo "服务已停止 (PID $PID)"
else
  echo "服务未在运行（PID $PID 已不存在），清理 PID 文件"
fi
rm -f "$PID_FILE"
