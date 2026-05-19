#!/bin/bash

echo "🧹 Limpiando locks de Chrome..."
find /app/.wwebjs_auth -name "SingletonLock" -delete 2>/dev/null || true
find /app/.wwebjs_auth -name "SingletonSocket" -delete 2>/dev/null || true
find /app/.wwebjs_auth -name "SingletonCookie" -delete 2>/dev/null || true
find /tmp -name ".org.chromium*" -delete 2>/dev/null || true
find /tmp -name "chrome_*" -type d -exec rm -rf {} + 2>/dev/null || true
echo "✅ Locks limpiados"

node node_modules/puppeteer/install.mjs
node index.js