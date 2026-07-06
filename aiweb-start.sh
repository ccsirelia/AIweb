#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_PORT="${FRONTEND_PORT:-5008}"
BACKEND_PORT="${BACKEND_PORT:-8008}"
RUNTIME_DIR="$ROOT/.runtime"
LOG_DIR="$RUNTIME_DIR/logs"
BACKEND_PID_FILE="$RUNTIME_DIR/aiweb-backend.pid"
FRONTEND_PID_FILE="$RUNTIME_DIR/aiweb-frontend.pid"

mkdir -p "$LOG_DIR"

is_aiweb_process() {
  local pid_file="$1"
  local kind="$2"
  [[ -f "$pid_file" ]] || return 1
  local pid
  pid="$(cat "$pid_file")"
  [[ -n "$pid" && -d "/proc/$pid" ]] || return 1
  local cmd
  cmd="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
  [[ "$cmd" == *"$ROOT"* ]] || return 1
  if [[ "$kind" == "backend" ]]; then
    [[ "$cmd" == *"uvicorn"* || "$cmd" == *"python"* ]]
  else
    [[ "$cmd" == *"next"* || "$cmd" == *"npm"* || "$cmd" == *"node"* ]]
  fi
}

if is_aiweb_process "$BACKEND_PID_FILE" "backend"; then
  echo "AIWeb backend already running. PID: $(cat "$BACKEND_PID_FILE")"
else
  PYTHON="$ROOT/backend/.venv/bin/python"
  if [[ ! -x "$PYTHON" ]]; then
    echo "Backend venv python not found: $PYTHON" >&2
    exit 1
  fi
  (
    cd "$ROOT/backend"
    setsid "$PYTHON" -m uvicorn main:app --reload --host 0.0.0.0 --port "$BACKEND_PORT" \
      > "$LOG_DIR/backend.out.log" 2> "$LOG_DIR/backend.err.log" &
    echo $! > "$BACKEND_PID_FILE"
  )
  echo "AIWeb backend started on http://localhost:$BACKEND_PORT. PID: $(cat "$BACKEND_PID_FILE")"
fi

if is_aiweb_process "$FRONTEND_PID_FILE" "frontend"; then
  echo "AIWeb frontend already running. PID: $(cat "$FRONTEND_PID_FILE")"
else
  (
    cd "$ROOT/frontend"
    setsid npm run dev -- -p "$FRONTEND_PORT" \
      > "$LOG_DIR/frontend.out.log" 2> "$LOG_DIR/frontend.err.log" &
    echo $! > "$FRONTEND_PID_FILE"
  )
  echo "AIWeb frontend started on http://localhost:$FRONTEND_PORT. PID: $(cat "$FRONTEND_PID_FILE")"
fi

echo
echo "AIWeb is starting:"
echo "  Frontend: http://localhost:$FRONTEND_PORT"
echo "  Backend : http://localhost:$BACKEND_PORT"
echo "  Logs    : $LOG_DIR"
