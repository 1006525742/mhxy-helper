#!/bin/bash
# 挖图后端 - 后台守护进程（nohup，可关闭 Terminal）
# 用法: 在 Terminal 里运行一次，关掉 Terminal 也不会停
#   ./start_watu.sh
# 停止:
#   cat /tmp/watu_ocr.pid | xargs kill

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="/tmp/watu_ocr.pid"
LOG_DIR="$SCRIPT_DIR/logs"
LOG_FILE="$LOG_DIR/watu-ocr.log"          # Python 自动轮转写入
DAEMON_LOG="$LOG_DIR/watu-daemon.log"     # 守护进程自身状态

mkdir -p "$LOG_DIR"

# 检查是否已在运行
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if kill -0 "$OLD_PID" 2>/dev/null; then
        echo "挖图后端已在运行 (PID: $OLD_PID)"
        exit 0
    fi
fi

# 后台启动守护循环
nohup bash -c '
    echo $$ > /tmp/watu_ocr.pid
    while true; do
        echo "$(date "+%H:%M:%S") 启动挖图后端..." >> "'"$DAEMON_LOG"'"
        /usr/bin/python3 "'"$SCRIPT_DIR"'/backend_watu.py" > /dev/null 2>&1
        echo "$(date "+%H:%M:%S") 退出, 3秒后重启..." >> "'"$DAEMON_LOG"'"
        sleep 3
    done
' > /dev/null 2>&1 &

sleep 2
if lsof -i :8003 &>/dev/null; then
    echo "挖图后端已启动 (PID: $(cat /tmp/watu_ocr.pid))"
    echo "日志文件: $LOG_FILE (保留30天)"
    echo "可以关闭 Terminal 了"
else
    echo "启动失败，查看日志: tail -f $LOG_FILE"
fi
