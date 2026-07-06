#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_DIR="$ROOT/.runtime"
BACKEND_PID_FILE="$RUNTIME_DIR/aiweb-backend.pid"
FRONTEND_PID_FILE="$RUNTIME_DIR/aiweb-frontend.pid"

stop_aiweb_process() {
  local pid_file="$1"
  local kind="$2"

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

  local cmd
  cmd="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
  if [[ "$cmd" != *"$ROOT"* ]]; then
    echo "Refusing to stop PID $pid because it does not look like an AIWeb $kind process." >&2
    exit 1
  fi

  if [[ "$kind" == "backend" && "$cmd" != *"uvicorn"* && "$cmd" != *"python"* ]]; then
    echo "Refusing to stop PID $pid because it does not look like an AIWeb backend process." >&2
    exit 1
  fi
  if [[ "$kind" == "frontend" && "$cmd" != *"next"* && "$cmd" != *"npm"* && "$cmd" != *"node"* ]]; then
    echo "Refusing to stop PID $pid because it does not look like an AIWeb frontend process." >&2
    exit 1
  fi

  kill "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
  sleep 2
  kill -9 "-$pid" 2>/dev/null || kill -9 "$pid" 2>/dev/null || true
  rm -f "$pid_file"
  echo "AIWeb $kind stopped. PID: $pid"
}

stop_aiweb_process "$FRONTEND_PID_FILE" "frontend"
stop_aiweb_process "$BACKEND_PID_FILE" "backend"
