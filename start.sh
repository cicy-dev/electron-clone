#!/bin/bash
# 一键启动克隆系统所有服务

SESSION="w-20130"
ROOT="/home/w3c_offical/workers/w-20130/electron-clone"

# 检查 tmux session 是否存在
if ! tmux has-session -t $SESSION 2>/dev/null; then
  echo "创建 tmux session: $SESSION"
  tmux new-session -d -s $SESSION
fi

# 启动 API 服务器 (端口 8835)
if ! tmux list-panes -t $SESSION -F '#{pane_title}' 2>/dev/null | grep -q "^api$"; then
  tmux new-window -t $SESSION -n api
fi
tmux send-keys -t $SESSION:api C-c 2>/dev/null
sleep 0.5
tmux send-keys -t $SESSION:api "cd $ROOT && node server.js" Enter
echo "✓ API 服务器启动 (端口 8835)"

# 启动 Wrangler (端口 8787)
if ! tmux list-panes -t $SESSION -F '#{pane_title}' 2>/dev/null | grep -q "^wrangler$"; then
  tmux new-window -t $SESSION -n wrangler
fi
tmux send-keys -t $SESSION:wrangler C-c 2>/dev/null
sleep 0.5
tmux send-keys -t $SESSION:wrangler "cd $ROOT/worker/clone-dev && npx wrangler dev --port 8787" Enter
echo "✓ Wrangler 启动 (端口 8787)"

# 启动 Vite (端口 8834)
if ! tmux list-panes -t $SESSION -F '#{pane_title}' 2>/dev/null | grep -q "^vite$"; then
  tmux new-window -t $SESSION -n vite
fi
tmux send-keys -t $SESSION:vite C-c 2>/dev/null
sleep 0.5
tmux send-keys -t $SESSION:vite "cd $ROOT/web && npx vite --port 8834 --host 0.0.0.0" Enter
echo "✓ Vite 启动 (端口 8834)"

echo ""
echo "所有服务已启动！"
echo "- API:      http://localhost:8835"
echo "- Wrangler: http://localhost:8787"
echo "- UI:       http://localhost:8834"
echo ""
echo "查看日志: tmux attach -t $SESSION"
