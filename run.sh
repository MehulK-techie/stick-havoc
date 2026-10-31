#!/usr/bin/env bash
# Stick Havoc: start the host (Linux and macOS). Double-click it, or ./run.sh
# Checks for Node.js, installs what's missing the first time, shows the
# address to give your friends, starts the server and opens your browser.
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-3000}"

if ! command -v node > /dev/null 2>&1; then
    echo "Stick Havoc needs Node.js (version 18 or newer)."
    echo "  Fedora:  sudo dnf install nodejs"
    echo "  Ubuntu:  sudo apt install nodejs npm"
    echo "  macOS:   brew install node   (or the installer at https://nodejs.org)"
    exit 1
fi
major=$(node -p 'process.versions.node.split(".")[0]')
if [ "$major" -lt 18 ]; then
    echo "Node.js $major is too old: Stick Havoc needs 18 or newer (https://nodejs.org)."
    exit 1
fi
if [ ! -d node_modules ]; then
    echo "First run: installing (express, ws, qrcode-terminal)..."
    npm install --no-audit --no-fund
fi

# open the browser once the server answers
(
    for _ in $(seq 1 40); do
        if node -e "require('http').get('http://localhost:$PORT/info', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))" 2> /dev/null; then
            url="http://localhost:$PORT"
            if command -v xdg-open > /dev/null 2>&1; then xdg-open "$url" > /dev/null 2>&1 || true
            elif command -v open > /dev/null 2>&1; then open "$url" || true
            fi
            exit 0
        fi
        sleep 0.25
    done
) &

echo "Starting Stick Havoc. Press Ctrl+C to stop it."
PORT="$PORT" exec node server.js
