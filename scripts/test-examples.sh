#!/bin/bash
set -e

# Build the root package first
npm run build

for dir in examples/*; do
  if [ -d "$dir" ]; then
    echo "--- Testing $dir ---"
    cd "$dir"
    npm install
    npm run build:wasm
    if npm run test --if-present; then
      echo "Tests passed for $dir"
    fi
    if npm run demo --if-present; then
      echo "Demo passed for $dir"
    fi
    if [ -d "tests" ] && [ -f "playwright.config.js" ]; then
      npx playwright install chromium
      npm run test:pw
    fi
    cd ../..
  fi
done
