#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
cd "$SCRIPT_DIR"

PROJECT_ROOT="$(pwd -P)"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
BACKEND_PORT="${BACKEND_PORT:-8008}"
RUNTIME_DIR=".runtime"
LOG_DIR="$RUNTIME_DIR/logs"
BACKEND_PID_FILE="$RUNTIME_DIR/aiweb-backend.pid"
FRONTEND_PID_FILE="$RUNTIME_DIR/aiweb-frontend.pid"

mkdir -p "$LOG_DIR"

process_cwd_matches() {
  local pid="$1"
  local expected_dir="$2"
  local cwd
  cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
  [[ "$cwd" == "$expected_dir" ]]
}

is_aiweb_process() {
  local pid_file="$1"
  local kind="$2"
  local expected_dir="$3"

  [[ -f "$pid_file" ]] || return 1
  local pid
  pid="$(cat "$pid_file")"
  [[ -n "$pid" && -d "/proc/$pid" ]] || return 1
  process_cwd_matches "$pid" "$expected_dir" || return 1

  local cmd
  cmd="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
  if [[ "$kind" == "backend" ]]; then
    [[ "$cmd" == *"uvicorn"* || "$cmd" == *"python"* ]]
  else
    [[ "$cmd" == *"next"* || "$cmd" == *"npm"* || "$cmd" == *"node"* ]]
  fi
}

if is_aiweb_process "$BACKEND_PID_FILE" "backend" "$PROJECT_ROOT/backend"; then
  echo "AIWeb backend already running. PID: $(cat "$BACKEND_PID_FILE")"
else
  PYTHON="backend/.venv/bin/python"
  if [[ ! -x "$PYTHON" ]]; then
    echo "Backend venv python not found: $PYTHON" >&2
    exit 1
  fi
  (
    cd backend
    setsid ./.venv/bin/python -m uvicorn main:app --reload --host 0.0.0.0 --port "$BACKEND_PORT" \
      > "../$LOG_DIR/backend.out.log" 2> "../$LOG_DIR/backend.err.log" &
    echo $! > "../$BACKEND_PID_FILE"
  )
  echo "AIWeb backend started on http://localhost:$BACKEND_PORT. PID: $(cat "$BACKEND_PID_FILE")"
fi

if is_aiweb_process "$FRONTEND_PID_FILE" "frontend" "$PROJECT_ROOT/frontend"; then
  echo "AIWeb frontend already running. PID: $(cat "$FRONTEND_PID_FILE")"
else
  NODE="${NODE:-node}"
  NEXT_BIN="frontend/node_modules/next/dist/bin/next"
  if [[ ! -f "$NEXT_BIN" ]]; then
    echo "Next.js runner not found: $NEXT_BIN. Please run npm install in frontend first." >&2
    exit 1
  fi
  (
    cd frontend
    setsid "$NODE" ./node_modules/next/dist/bin/next dev -p "$FRONTEND_PORT" \
      > "../$LOG_DIR/frontend.out.log" 2> "../$LOG_DIR/frontend.err.log" &
    echo $! > "../$FRONTEND_PID_FILE"
  )
  echo "AIWeb frontend started on http://localhost:$FRONTEND_PORT. PID: $(cat "$FRONTEND_PID_FILE")"
fi

echo
echo "AIWeb is starting:"
echo "  Frontend: http://localhost:$FRONTEND_PORT"
echo "  Backend : http://localhost:$BACKEND_PORT"
echo "  Logs    : $LOG_DIR"
