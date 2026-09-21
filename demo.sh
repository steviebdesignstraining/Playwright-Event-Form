#!/usr/bin/env bash
# Demo Script — Event Registration Test Suite
# Run this script to demonstrate the project in a clear, sequential flow.
# Usage: bash demo.sh [option]
#
# Options:
#   all       Run full demo (default) — setup, API tests, browser tests, report
#   api       Run API tests only
#   browser   Run browser tests only
#   report    Generate and open Allure report only
#   clean     Clean generated artifacts

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo "  EVENT REGISTRATION — TEST SUITE DEMO"
echo "═══════════════════════════════════════════════════════════════════"
echo ""

run_api_tests() {
  echo ""
  echo "▶ STEP 1: API Regression Tests (21 tests)"
  echo "────────────────────────────────────────────"
  npx playwright test api.spec.ts --reporter=list 2>&1 || echo "  (API tests encountered issues — review output above)"
  echo ""
}

run_browser_tests() {
  echo ""
  echo "▶ STEP 2: Browser Tests (8 tests — Chromium + WebKit)"
  echo "─────────────────────────────────────────────────────"
  npx playwright test browser.spec.ts --reporter=list 2>&1 || echo "  (Browser tests encountered issues — review output above)"
  echo ""
}

generate_report() {
  echo ""
  echo "▶ STEP 3: Generate Allure Report"
  echo "─────────────────────────────────"
  npm run allure:generate 2>&1
  echo ""
  echo "  Allure report generated at: allure-report/index.html"
  echo ""
}

show_structure() {
  echo ""
  echo "▶ PROJECT STRUCTURE"
  echo "───────────────────"
  echo "  e2e/tests/api.spec.ts         — 21 API regression tests"
  echo "  e2e/tests/browser.spec.ts     — 8 browser E2E tests"
  echo "  e2e/pages/                     — Page Object Models"
  echo "  e2e/selectors/                 — Centralised selectors"
  echo "  e2e/test-data/                 — Test data & fixtures"
  echo "  src/server/                    — Express API server"
  echo "  src/client/                    — Frontend SPA"
  echo ""
}

show_live_checks() {
  echo ""
  echo "▶ LIVE HEALTH CHECKS"
  echo "────────────────────"
  echo "  Application:  http://127.0.0.1:3000"
  echo "  API Docs:     http://127.0.0.1:3000/api-docs"
  echo "  Health:       http://127.0.0.1:3000/api/health"
  echo ""
  echo "  (Start server with: npm start)"
  echo ""
}

# ── Parse argument ──
MODE="${1:-all}"

case "$MODE" in
  api)
    show_structure
    run_api_tests
    ;;
  browser)
    show_structure
    run_browser_tests
    ;;
  report)
    generate_report
    ;;
  clean)
    echo ""
    echo "▶ CLEANING ARTIFACTS"
    echo "────────────────────"
    rm -rf allure-report allure-results test-results playwright-report
    echo "  Cleaned: allure-report/, allure-results/, test-results/, playwright-report/"
    echo ""
    ;;
  all)
    show_structure
    show_live_checks
    run_api_tests
    run_browser_tests
    generate_report
    echo ""
    echo "═══════════════════════════════════════════════════════════════════"
    echo "  DEMO COMPLETE"
    echo "═══════════════════════════════════════════════════════════════════"
    echo ""
    echo "  Reports:"
    echo "    Allure HTML  → allure-report/index.html"
    echo "    Playwright   → playwright-report/index.html"
    echo ""
    echo "  View Allure report: npm run allure:open"
    echo ""
    ;;
  *)
    echo "  Unknown option: $MODE"
    echo "  Usage: bash demo.sh [all|api|browser|report|clean]"
    exit 1
    ;;
esac
