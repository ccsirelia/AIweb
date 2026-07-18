#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
cd "$SCRIPT_DIR"

PROJECT_ROOT="$(pwd -P)"
RUNTIME_DIR=".runtime"
BACKEND_PID_FILE="$RUNTIME_DIR/aiweb-backend.pid"
FRONTEND_PID_FILE="$RUNTIME_DIR/aiweb-frontend.pid"

process_cwd_matches() {
  local pid="$1"
  local expected_dir="$2"
  local cwd
  cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
  [[ "$cwd" == "$expected_dir" ]]
}

stop_aiweb_process() {
  local pid_file="$1"
  local kind="$2"
  local expected_dir="$3"

  if [[ ! -f "$pid_file" ]]; then
    echo "AIWeb $kind is not tracked as running."
    return
  fi

  local pid
  pid="$(cat "$pid_file")"
  if [[ -z "$pid" || ! -d "/proc/$pid" ]]; then
    rm -f "$pid_file"
    echo "AIWeb $kind PID file removed; process was not running."
    return
  fi

  if ! process_cwd_matches "$pid" "$expected_dir"; then
    rm -f "$pid_file"
    echo "AIWeb $kind PID file removed; tracked PID $pid did not match this project."
    return
  fi

  local cmd
  cmd="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
  if [[ "$kind" == "backend" && "$cmd" != *"uvicorn"* && "$cmd" != *"python"* ]]; then
    rm -f "$pid_file"
    echo "AIWeb backend PID file removed; tracked PID $pid did not match backend."
    return
  fi
  if [[ "$kind" == "frontend" && "$cmd" != *"next"* && "$cmd" != *"npm"* && "$cmd" != *"node"* ]]; then
    rm -f "$pid_file"
    echo "AIWeb frontend PID file removed; tracked PID $pid did not match frontend."
    return
  fi

  kill "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
  sleep 2
  kill -9 "-$pid" 2>/dev/null || kill -9 "$pid" 2>/dev/null || true
  rm -f "$pid_file"
  echo "AIWeb $kind stopped. PID: $pid"
}

stop_aiweb_process "$FRONTEND_PID_FILE" "frontend" "$PROJECT_ROOT/frontend"
stop_aiweb_process "$BACKEND_PID_FILE" "backend" "$PROJECT_ROOT/backend"
