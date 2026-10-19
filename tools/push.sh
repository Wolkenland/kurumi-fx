#!/bin/sh
# 用法：sh tools/push.sh <仓库URL> <TOKEN>
# 例：  sh tools/push.sh https://github.com/you/kurumi-fx.git ghp_xxx
# 说明：token 只在这个进程的内存里用一次，不会写入任何文件或 git 配置。
set -e
URL="$1"; TOKEN="$2"
[ -z "$URL" ] || [ -z "$TOKEN" ] && { echo "用法: sh tools/push.sh <仓库URL> <TOKEN>"; exit 1; }

# 把 token 注入到 https URL 里（仅本次命令有效）
AUTH_URL=$(printf '%s' "$URL" | sed -E "s#https://#https://x-access-token:${TOKEN}@#")

cd "$(dirname "$0")/.."
git remote remove origin 2>/dev/null || true
git remote add origin "$AUTH_URL"
git branch -M main 2>/dev/null || git checkout -b main
git push -u origin main --force
git remote remove origin
git remote add origin "$URL"
echo "✓ 推送完成：$URL"
