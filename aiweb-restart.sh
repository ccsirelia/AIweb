#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$ROOT/aiweb-stop.sh"
sleep 2
"$ROOT/aiweb-start.sh"
