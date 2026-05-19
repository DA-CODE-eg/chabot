#!/bin/bash

# Limpiar locks de Chrome que quedan de deploys anteriores
# Esto evita el error "Opening in existing browser session"
find /app/.wwebjs_auth -name "SingletonLock" -delete 2>/dev/null || true
find /app/.wwebjs_auth -name "SingletonSocket" -delete 2>/dev/null || true
find /app/.wwebjs_auth -name "SingletonCookie" -delete 2>/dev/null || true
find /tmp -name ".org.chromium*" -delete 2>/dev/null || true
find /tmp -name "chrome_*" -type d -exec rm -rf {} + 2>/dev/null || true

echo "✅ Locks de Chrome limpiados"

node node_modules/puppeteer/install.mjs
node index.js