#!/bin/bash
# 重启 mhxy 外网链路所需的本机服务：frpc 隧道 + 挖图后端
# 用法：在 Mac 终端执行  bash ~/mhxy-helper/restart_mhxy.sh
# 说明：物价手册(wuji) 已于 2026-09 下线移除；公网入口统一为 yjmhxy.top（京东云 frpc 通道）。
set -e

echo "==> 重启 frpc 隧道（frpc.toml 全部隧道：web/api/keju/baotu/watu/sprite/cixin/gold/cbg/dati/harvest/analytics）"
launchctl kickstart -k gui/$(id -u)/com.mhxy.frpc 2>/dev/null || \
  launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.mhxy.frpc.plist 2>/dev/null || true

echo "==> 拉起挖图后端 (watu, 8003)"
# bootstrap 只需一次（之后 launchd 记住）；已存在会报 37，忽略即可
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.mhxy.watu.plist 2>/dev/null || true
sleep 1
launchctl kickstart -k gui/$(id -u)/com.mhxy.watu 2>/dev/null || true

echo "==> 拉起慈心下棋后端 (cixin, 8005)"
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.mhxy.cixin.plist 2>/dev/null || true
sleep 1
launchctl kickstart -k gui/$(id -u)/com.mhxy.cixin 2>/dev/null || true

echo "==> 等待 3 秒让服务起来…"
sleep 3

echo "==> 验证外网 watu 健康"
curl -sk -w "\nHTTP_CODE=%{http_code}\n" https://117.72.108.169/api/watu/health || true
echo "==> 验证外网 cixin 路由"
curl -sk -w "\nHTTP_CODE=%{http_code}\n" https://117.72.108.169/api/othello/status || true
echo ""
echo "完成。若仍 502，请确认 Mac 未休眠且本脚本以你的用户运行。"
