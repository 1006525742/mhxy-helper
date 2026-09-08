#!/bin/bash
# 一键部署：分图助手/挖图助手后端外网访问
# 用途：① 推送 Nginx 配置到 VPS 并热重载  ② 重启 frpc 加载新隧道  ③ 拉起挖图后端(watu)
# 用法：在 Mac 终端运行  bash ~/mhxy-helper/deploy_mhxy_apis.sh
set -u

VPS="root@117.72.108.169"
NGINX_SRC="/Users/zhy/WorkBuddy/2026-07-03-22-49-14/mhxy_nginx_new.conf"
NGINX_DST="/etc/nginx/sites-available/mhxy"
WATU_PLIST="$HOME/Library/LaunchAgents/com.mhxy.watu.plist"
UID_=$(id -u)

echo "============================================"
echo " [1/3] 推送 Nginx 配置到 VPS 并热重载"
echo "============================================"
echo "-> 备份 VPS 现有配置"
ssh "$VPS" "cp $NGINX_DST ${NGINX_DST}.bak.\$(date +%s) 2>/dev/null; echo backed_up"
echo "-> scp 上传新配置 (若提示密码，输入 VPS root 密码)"
scp "$NGINX_SRC" "${VPS}:${NGINX_DST}"
echo "-> 语法检查 + 重载 nginx"
ssh "$VPS" "nginx -t && systemctl reload nginx && echo NGINX_RELOADED"

echo ""
echo "============================================"
echo " [2/3] 重启 frpc，加载新隧道 8003->8084"
echo "============================================"
launchctl kickstart -k "gui/$UID_/com.mhxy.frpc" && echo "FRPC_RESTARTED" || echo "FRPC_RESTART_FAILED(检查 com.mhxy.frpc 是否在运行)"

echo ""
echo "============================================"
echo " [3/3] 拉起挖图后端 watu (launchd)"
echo "============================================"
if launchctl bootstrap "gui/$UID_" "$WATU_PLIST" 2>/dev/null; then
  echo "WATU_BOOTSTRAPPED"
elif launchctl load "$WATU_PLIST" 2>/dev/null; then
  echo "WATU_LOADED(legacy)"
else
  echo "WATU_BOOTSTRAP_FAILED(可能已加载，忽略)"
fi
# 确保真的起来
sleep 2
launchctl start "gui/$UID_/com.mhxy.watu" 2>/dev/null
echo "done"

echo ""
echo "============================================"
echo " 验证（外网）"
echo "============================================"
echo "-> GET /api/watu/health"
curl -k -s --max-time 10 https://117.72.108.169/api/watu/health; echo
echo "-> POST /api/fentu/capture (空图，预期 200 + success:false，不再是 404)"
curl -k -s --max-time 10 -X POST https://117.72.108.169/api/fentu/capture \
  -H 'Content-Type: application/json' -d '{"image":""}'; echo
echo ""
echo "结束。若 watu/health 返回 service:watu 且 fentu 不再 404，即全部成功。"
