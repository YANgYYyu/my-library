#!/usr/bin/env bash
# 启动或重启 Prompt & Skills 预览服务（端口固定 8001）。
set -euo pipefail

PORT=8001
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PUBLIC_DIR="$ROOT_DIR/public"
PID_FILE="/tmp/my-library-server-$PORT.pid"
LOG_FILE="/tmp/my-library-server-$PORT.log"

# 停止由本脚本启动的旧实例
if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "停止旧实例 (PID $(cat "$PID_FILE"))"
  kill "$(cat "$PID_FILE")" 2>/dev/null || true
  sleep 1
fi
rm -f "$PID_FILE"

# 端口被其他进程占用时给出明确报错
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "端口 $PORT 已被其他进程占用，请先处理后再重启" >&2
  exit 1
fi

nohup python3 -m http.server "$PORT" --directory "$PUBLIC_DIR" >"$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"

sleep 1
if kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "服务已启动: http://localhost:$PORT (PID $(cat "$PID_FILE"))"
else
  echo "启动失败，请查看日志: $LOG_FILE" >&2
  exit 1
fi
