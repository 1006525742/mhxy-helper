#!/bin/bash
# 梦幻西游助手 - 启动所有后端
# 抓鬼后端 (8000) + 科举答题后端 (8001) + 宝图（分图）后端 (8002)
# 用法: ./start_all.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
LOGDIR="/tmp/mhxy-logs"
mkdir -p "$LOGDIR"

echo "=== 梦幻西游助手 - 启动后端 ==="

# 停止旧进程
kill $(lsof -ti:8000) 2>/dev/null
kill $(lsof -ti:8001) 2>/dev/null
kill $(lsof -ti:8002) 2>/dev/null
kill $(lsof -ti:8005) 2>/dev/null
sleep 1

# 启动抓鬼后端 (port 8000)
echo "[1/3] 启动抓鬼后端 (8000)..."
cd "$BACKEND_DIR"
nohup python3 -m uvicorn backend_ghost:app --host 0.0.0.0 --port 8000 > "$LOGDIR/ghost.log" 2>&1 &
GHOST_PID=$!

# 启动科举答题后端 (port 8001)
echo "[2/3] 启动科举答题后端 (8001)..."
nohup python3 -m uvicorn backend_keju:app --host 0.0.0.0 --port 8001 > "$LOGDIR/keju.log" 2>&1 &
KEJU_PID=$!

# 启动宝图（分图）后端 (port 8002)
echo "[3/4] 启动宝图（分图）后端 (8002)..."
nohup python3 -m uvicorn backend_baotu:app --host 0.0.0.0 --port 8002 > "$LOGDIR/baotu.log" 2>&1 &
BAOTU_PID=$!

# 启动慈心黑白棋后端 (port 8005)
echo "[4/4] 启动慈心黑白棋后端 (8005)..."
nohup python3 -m uvicorn backend_cixin:app --host 0.0.0.0 --port 8005 > "$LOGDIR/cixin.log" 2>&1 &
CIXIN_PID=$!

sleep 3

# 健康检查
echo ""
echo "=== 健康检查 ==="
HEALTH_GHOST=$(curl -s http://localhost:8000/health 2>/dev/null)
HEALTH_KEJU=$(curl -s http://localhost:8001/health 2>/dev/null)
HEALTH_BAOTU=$(curl -s http://localhost:8002/health 2>/dev/null)
HEALTH_CIXIN=$(curl -s http://localhost:8005/health 2>/dev/null)

if [ -n "$HEALTH_GHOST" ]; then
    echo "✅ 抓鬼后端 (8000): $HEALTH_GHOST (PID: $GHOST_PID)"
else
    echo "❌ 抓鬼后端 (8000) 启动失败"
fi

if [ -n "$HEALTH_KEJU" ]; then
    echo "✅ 科举答题后端 (8001): $HEALTH_KEJU (PID: $KEJU_PID)"
else
    echo "❌ 科举答题后端 (8001) 启动失败"
fi

if [ -n "$HEALTH_BAOTU" ]; then
    echo "✅ 宝图（分图）后端 (8002): $HEALTH_BAOTU (PID: $BAOTU_PID)"
else
    echo "❌ 宝图（分图）后端 (8002) 启动失败"
fi

if [ -n "$HEALTH_CIXIN" ]; then
    echo "✅ 慈心黑白棋后端 (8005): $HEALTH_CIXIN (PID: $CIXIN_PID)"
else
    echo "❌ 慈心黑白棋后端 (8005) 启动失败"
fi

echo ""
echo "日志文件: $LOGDIR/ghost.log, $LOGDIR/keju.log, $LOGDIR/baotu.log"
echo "宝图服务独立日志（含 OCR 明细）也可在 backend/logs/baotu.log 查看"
