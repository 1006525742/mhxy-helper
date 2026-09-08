#!/usr/bin/env bash
# 启动藏宝阁(CBG)后端服务，端口 8006
# 用法：bash cbg-extension/start_cbg.sh
set -e

# 切到 backend 目录（脚本位于 cbg-extension/ 下一级）
cd "$(dirname "$0")/../backend"

echo "==> 启动 CBG 后端 (http://127.0.0.1:8006) ..."
echo "    依赖：fastapi, uvicorn, pydantic"
echo "    未安装可运行：pip install fastapi uvicorn pydantic"

python3 backend_cbg.py
