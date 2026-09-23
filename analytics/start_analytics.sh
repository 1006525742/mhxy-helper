#!/bin/bash
# 手动启动统计服务（launchd 未加载时的备用方式）
# 用法：bash /Users/zhy/mhxy-helper/analytics/start_analytics.sh
cd "$(dirname "$0")"
mkdir -p logs
exec /usr/bin/python3 analytics_server.py
