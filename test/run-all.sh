#!/bin/sh
# 一键跑全部测试
set -e
cd "$(dirname "$0")/.."
node build.js
echo
node test/headless.js
node test/static-check.js
node test/playthrough.js
node test/ai-module.js
node test/insight-perks.js
node test/save-system.js
node test/achievements.js
node test/ai-pacing.js
node test/ai-contest.js
node test/daily-tasks.js
node test/ai-native-bridge.js
if [ -d /tmp/domtest/node_modules/jsdom ]; then
  NODE_PATH=/tmp/domtest/node_modules node test/dom-smoke.js
  NODE_PATH=/tmp/domtest/node_modules node test/ai-ui.js
  NODE_PATH=/tmp/domtest/node_modules node test/insight-ui.js
  NODE_PATH=/tmp/domtest/node_modules node test/save-ui.js
  NODE_PATH=/tmp/domtest/node_modules node test/achievements-ui.js
  NODE_PATH=/tmp/domtest/node_modules node test/ai-pacing-ui.js
  NODE_PATH=/tmp/domtest/node_modules node test/daily-ui.js
else
  echo "（跳过 DOM 冒烟测试：未安装 jsdom。安装：cd /tmp/domtest && npm i jsdom）"
fi
