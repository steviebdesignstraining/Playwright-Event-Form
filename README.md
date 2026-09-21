# 🚀 Stephen Bennett's QA Automation Project

[](https://github.com/stephen-bennett-qa/stephen-bennett-qa/actions/workflows/playwright-allure.yml/badge.svg)

## 👋 Introduction

![Stephen_.png](https://github.com/steviebdesignstraining/waracle_takehome_Test/raw/main/Stephen_.png)

Hi there\! Before we blast off into the code-verse, I want to introduce myself. My name is **Stephen Bennett**, and I've been immersed in the world of testing for over **12 years**. I genuinely enjoy the development space and bringing a positive, optimistic, and adaptable spirit to any team. I'm sociable and thrive in diverse environments, working well with all personalities.

First off, I absolutely **loved** completing this Senior QA Engineer assessment\! I built a comprehensive **Playwright** automation framework with **TypeScript** for both API and UI testing.

Let's dive into what I've accomplished\!

-----

## 🎯 Project Overview

This project is a **Senior QA Engineer technical assessment** featuring a standalone event registration application with a REST API and web frontend. The application manages event registrations with capacity limits, waitlists, and cancellation workflows.

### 🔍 Scope of Automation

My automated tests cover positive and negative scenarios for both **API** and **Browser (UI)** layers using Playwright with TypeScript:

- **API Tests**: Event retrieval, registration creation (valid/invalid), duplicate handling, capacity limits, waitlist management, cancellation workflows, registration updates
- **Browser Tests**: End-to-end registration flows, validation errors (empty name, empty email, invalid email), registration confirmation display

The tests are implemented using **Playwright with TypeScript**, adhering to best practices including Page Object Model, fixtures, and Allure reporting.

🔗 **Local Application**: http://127.0.0.1:3000  
🔗 **API Documentation**: http://127.0.0.1:3000/api-docs  
🔗 **Health Check**: http://127.0.0.1:3000/api/health

-----

## 📋 Manual Test Plan

I've created a detailed **manual test plan** that outlines the key user flows, cases, and scenarios that have been automated. This plan ensures all critical functionalities of the event registration system are thoroughly tested.

📖 **View Manual Test Plan**: [Future Form Events Test Plan](https://app.notion.com/p/Future-Form-Events-Test-Plan-3d740221abc08079ae25eac4f2460add?source=copy_link)

📖 **View Assessment Instructions**: [ASSESSMENT.md](./ASSESSMENT.md)

-----

## 🛠️ Setup Instructions

Getting the framework up and running is straightforward:

1.  **Clone the repository**:

    ```bash
    git clone https://github.com/stephen-bennett-qa/stephen-bennett-qa.git
    cd stephen-bennett-qa
    ```

2.  **Install dependencies**:

    ```bash
    npm install
    ```

3.  **Install Playwright browsers** (if not already installed):

    ```bash
    npm run setup:browsers
    ```

4.  **Configure environment** (optional - uses defaults if not set):

    ```bash
    cp .env.example .env.local
    # Edit .env.local with your secrets
    ```

### Running Tests

Choose your preferred execution method:

| Command                         | Description                                              |
| :------------------------------ | :------------------------------------------------------- |
| `npm test`                      | Run all Playwright tests (API + Browser)                 |
| `npm run test:ui`               | Open Playwright UI mode for interactive test development |
| `npm run test:ci`               | Run tests in CI mode (4 workers, 1 retry)                |
| `npm run allure:generate`       | Generate Allure HTML report from test results            |
| `npm run allure:open`           | Open Allure report in browser                            |
| `npm start`                     | Start the application server                             |

### Secrets Management

Manage environment-specific secrets using the built-in CLI:

| Command                          | Description                                         |
| :------------------------------- | :-------------------------------------------------- |
| `npm run secrets:init`           | Initialise venv structure with example environments |
| `npm run secrets:push local`     | Push .env.local to .venv/.venv.local               |
| `npm run secrets:pull staging`   | Pull .venv/.venv.staging to .env.local             |
| `npm run secrets:list`           | List available venv environments                    |

-----

### CI/CD Pipeline and Report Dashboard

``` Review Allure report via GitHub Actions Artifacts
Download the 'allure-report' artifact from the workflow run
```

``` To access the CI/CD pipeline
https://github.com/stephen-bennett-qa/stephen-bennett-qa/actions
```

The CI/CD pipeline (`.github/workflows/playwright-allure.yml`) runs on every push/PR to main/master and includes:
1. **Run Tests** - Executes Playwright tests with retries
2. **Generate Allure Report** - Creates HTML report from test results
3. **Upload Artifacts** - Allure report, Playwright report, traces, and raw results

-----

## ✨ Features & Best Practices

  * **TypeScript Support**: Full TypeScript implementation with robust type checking (`npm run typecheck`)
  * **Page Object Model (POM)**: Maintainable and scalable test architecture in `e2e/pages/`
  * **Playwright Fixtures**: Centralised test setup with reusable dependencies (`e2e/fixtures/test-fixtures.ts`) — `indexPage`, `api`, `resetStore`
  * **Role-Based Locators**: Semantic, accessibility-first selectors using Playwright's `getByRole`, `getByLabel`, `getByText` (`e2e/selectors/index.ts`)
  * **Test Data Management**: Organised test data in `e2e/test-data/`
  * **Environment Configuration**: Flexible test environments via `.env` / `.env.local` / `.venv/`
  * **Selectors Centralisation**: Reusable selectors in `e2e/selectors/index.ts`
  * **Multiple Test Suites**: Separate API (`api.spec.ts`) and Browser (`browser.spec.ts`) test files
  * **Cross-browser Testing**: Support for Chromium and WebKit browsers
  * **Retry Logic**: Automatic test retries (1 retry in CI) for improved reliability
  * **Allure Reports**: Detailed and interactive test reports with screenshots/traces
  * **Playwright Traces**: Full trace capture on failure for debugging
  * **Secrets Management**: Custom CLI for managing environment-specific secrets securely

-----

### Architecture Highlights

1.  **Page Object Model**: For a highly maintainable and scalable test structure (`e2e/pages/`)
2.  **TypeScript**: Ensures type safety and provides a superior developer experience
3.  **Playwright Fixtures**: Centralised test setup with reusable dependencies (`e2e/fixtures/test-fixtures.ts`) — `indexPage`, `api`, `resetStore`
4.  **Role-Based Locators**: Semantic, accessibility-first selectors using Playwright's `getByRole`, `getByLabel`, `getByText` (`e2e/selectors/index.ts`)
5.  **Test Data Management**: Organised test data in `e2e/test-data/`
6.  **Selectors Centralisation**: Centralised element locators for easy maintenance (`e2e/selectors/`)
7.  **Environment Configuration**: Offers flexibility for different testing environments
8.  **Comprehensive Error Handling**: Robust management of test failures with traces
9.  **Cross-browser Testing**: Ensures broad compatibility (Chromium, WebKit)
10. **Retry Logic**: Enhances test reliability by mitigating flakiness
11. **Allure Integration**: Rich reporting with categories, history, and trace viewer
12. **Secrets Protection**: `.env.local` and `.venv/` gitignored; `.env.example` committed

-----

### Troubleshooting Steps:

For any issues or questions during execution:

1.  Always **check the test execution videos and screenshots** first (in `test-results/`)
2.  **Review the console output** for detailed error messages
3.  **Validate your environment configuration** in the `.env.local` file
4.  **Ensure all dependencies are properly installed** (`npm install`)
5.  **Check Playwright traces** for failed tests (download `playwright-test-results` artifact)
6.  **Run with UI mode** for debugging: `npm run test:ui`

-----

## 📁 Project Structure

```
stephen-bennett-qa/
├── .github/
│   └── workflows/
│       └── playwright-allure.yml    # CI/CD pipeline
├── .venv/                           # Environment secrets (gitignored)
│   ├── .venv.local
│   ├── .venv.staging
│   └── .venv.production
├── e2e/
│   ├── fixtures/                    # Playwright fixtures
│   │   ├── test-fixtures.ts         # Extended test with fixtures (indexPage, api, resetStore)
│   │   └── README.md                # Fixture documentation
│   ├── pages/                       # Page Object Models
│   │   ├── index.page.ts
│   │   ├── api.pages.ts
│   ├── selectors/                   # Centralised selectors
│   │   └── index.ts
│   ├── test-data/                   # Test data
│   │   ├── apiTestdata.data.ts
│   │   └── registration.data.ts
│   └── tests/                       # Test specifications
│       ├── api.spec.ts
│       └── browser.spec.ts
├── scripts/
│   └── secrets.mjs                  # Secrets management CLI
├── src/
│   ├── client/                      # Frontend application
│   │   ├── app.ts
│   │   ├── index.html
│   │   └── styles.css
│   └── server/                      # Backend API
│       ├── index.ts
│       ├── store.ts
│       ├── types.ts
│       └── openapi.yaml
├── .env                             # Example env (committed)
├── .env.example                     # Env template (committed)
├── .env.local                       # Local secrets (gitignored)
├── .gitignore
├── package.json
├── playwright.config.ts
├── tsconfig.json
└── README.md
```

-----

*Built with ❤️ by Stephen Bennett — Senior QA Engineer*