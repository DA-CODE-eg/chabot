#!/bin/bash
node node_modules/puppeteer/install.mjs
rm -rf /app/.wwebjs_auth
node index.js