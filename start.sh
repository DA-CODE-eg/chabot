#!/bin/bash
node node_modules/puppeteer/install.mjs
rm -rf /app/.wwebjs_auth/session-legal-segura/SingletonLock
rm -rf /app/.wwebjs_auth/session-legal-segura/SingletonCookie
node index.js