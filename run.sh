#!/bin/sh
# HA Add-on 启动脚本 (纯 sh, 不依赖 bashio)
set -e

echo "[mihome] 启动: 生成 config.json from options.json"
node /app/options2config.js || echo "[mihome] options2config 跳过 (使用已有 config.json)"

echo "[mihome] 调试: 9898 端口占用情况:"
netstat -ulnp 2>/dev/null | grep 9898 || echo "(netstat 无 9898 或不可用)"
echo "[mihome] 网络接口:"
ip addr show 2>/dev/null | grep -E "inet |multicast" | head -5 || true

echo "[mihome] 启动 index.js"
exec node /app/index.js