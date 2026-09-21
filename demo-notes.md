# Demo Notes — Event Registration Test Suite

---

## 1. Project Overview

This project is a **Senior QA Engineer technical assessment** — a standalone event registration application with a REST API and a browser-based frontend. The system manages event registrations with capacity limits, waitlists, and cancellation workflows.

- **Application URL**: http://127.0.0.1:3000
- **API URL**: http://127.0.0.1:3000/api
- **API Docs**: http://127.0.0.1:3000/api-docs
- **Health Check**: http://127.0.0.1:3000/api/health
- **Tech Stack**: TypeScript, Playwright, Express, Allure Reporting

---

## 2. Project Structure

```
e2e/
├── fixtures/
│   ├── test-fixtures.ts       # Playwright fixtures (indexPage, api, resetStore)
│   └── README.md              # Fixture documentation
├── tests/
│   ├── api.spec.ts            # API regression tests (21 tests)
│   └── browser.spec.ts        # Browser/UI tests (8 tests)
├── pages/
│   ├── index.page.ts          # Page Object for the main event page, inbox, cancellation, registration form
│   ├── api.pages.ts           # Page Object for API calls (request-based)
├── selectors/
│   └── index.ts               # All CSS/role selectors centralised here
└── test-data/
    ├── apiTestdata.data.ts    # API test data (payloads, event IDs, status strings)
    └── registration.data.ts   # Browser test data (error messages, email constants)
src/
├── server/
│   ├── index.ts             # Express app, route handlers
│   ├── store.ts             # In-memory data store (registrations, messages, events)
│   ├── types.ts             # TypeScript interfaces
│   └── openapi.yaml         # OpenAPI specification
└── client/
    ├── app.ts               # Frontend SPA logic (rendering, form submission, routing)
    ├── index.html           # HTML shell
    └── styles.css           # Styles
playwright.config.ts         # Playwright config (3 projects: api, chromium, webkit)
package.json                 # Scripts and dependencies
```

---

## 3. Test Architecture & Code Structure Choices

### 3a. Page Object Model (POM)

Tests use the **Page Object Model** pattern to encapsulate page interactions:

| Page Object | File | Purpose |
|---|---|---|
| `IndexPage` | `e2e/pages/index.page.ts` | Main browser page — event display, registration form, inbox, cancellation page |
| `ApiPage` | `e2e/pages/api.pages.ts` | API helper — wraps `APIRequestContext` methods (GET/POST/PATCH to API endpoints) |

**Why this structure?**
- POM separates test logic from DOM selectors, improving maintainability.
- `IndexPage` is the primary page object used in browser tests, providing methods like `registerGuest()`, `openTestInbox()`, and `resetStore()`.
- `ApiPage` abstracts HTTP calls for API tests, keeping tests clean and readable.

### 3b. Selectors Centralisation — Role-Based Locators

All locators live in `e2e/selectors/index.ts` using Playwright's recommended role-based and semantic selectors. This follows Playwright best practices for accessibility-first testing:

- **Role-based**: `getByRole('button', { name: 'Register' })`, `getByRole('heading', { level: 1 })`
- **Label-based**: `getByLabel('Name')` (where proper `<label>` elements exist)
- **Text-based**: `getByText('Free one-day forum')` for static text
- **Attribute-based**: `locator('[name="email"]')` for form fields without accessible labels
- **Test IDs**: `getByTestId('...')` for elements needing stable identifiers

Benefits:
- If the UI changes, locators are updated in one file.
- Selector reuse across page objects is ensured.
- Tests are more resilient to CSS changes.
- Encourages accessible markup (role-based locators work best with semantic HTML).

### 3c. Test Data Separation

Test data is separated into two files:
- `apiTestdata.data.ts` — payloads, event IDs, status constants, error messages for API tests
- `registration.data.ts` — error messages, email constants, inbox-related constants for browser tests

Data is defined as exported constants and functions (e.g., `randomEmail()`), so each test call generates unique values.

### 3d. Playwright Configuration (`playwright.config.ts`)

Three test projects run from one config:
| Project | Test Match | Browser |
|---|---|---|
| `api` | `api.spec.ts` | N/A (API-only) |
| `chromium` | All except `api.spec.ts` | Desktop Chrome |
| `webkit` | All except `api.spec.ts` | Desktop Safari |

- `fullyParallel: false` — tests run sequentially (important for `test.describe.serial` blocks)
- `workers: 1` — single worker for deterministic execution
- Auto-starts the server via `webServer` command: `npm start`
- Reporters: list, HTML, and Allure

---

## 4. What Each Test Does — API Tests (`api.spec.ts`)

All API tests are inside a `test.describe.serial("API Regression Tests")` block, meaning they execute **in order** and share state via `beforeEach` reset.

### Setup

Every test runs `test.beforeEach` which:
1. Creates a fresh `ApiPage` instance
2. Calls `api.resetStore()` — POST `/api/reset` — restores the seeded in-memory state (3 confirmed, 2 waiting registrations)
3. Resets local ID tracking variables

---

### Describe Block: "Create Registration" (7 tests)

**Test 1: Create registration with valid data**
- **What**: POST a valid registration payload (name, email, organisation, dietary, accessibility, marketing consent) to the event
- **Code**: `api.createRegistration(EVENT_ID, validRegistration)`
- **Assertions**: Status 201, response has `id`, name matches, status is `confirmed`
- **Why**: Happy path — verifies core registration functionality

**Test 2: Create registration when event is full**
- **What**: Fills the event to capacity (3 confirmed), then creates one more registration
- **Code**: Loops creating confirmed registrations until capacity reached, then creates `waitingListRegistration`
- **Assertions**: Last registration returns 201 with status `waiting`
- **Why**: Verifies capacity enforcement and waitlist logic

**Test 3: Create duplicate registration**
- **What**: Registers the same email twice
- **Code**: First call succeeds (201), second call with same data
- **Assertions**: Second call returns 409 with message containing "already registered"
- **Why**: Prevents duplicate entries — data integrity check

**Test 4: Create registration without email**
- **What**: Sends registration with empty email string
- **Code**: `api.createRegistration(EVENT_ID, invalidRegistrationEmptyEmail)`
- **Assertions**: Status 400, response has `message` property
- **Why**: Server-side validation — email is required

**Test 5: Create registration without name**
- **What**: Sends registration with empty name
- **Code**: `api.createRegistration(EVENT_ID, invalidRegistrationEmptyName)`
- **Assertions**: Status 201, response has `id`
- **Note**: Server allows registration without a name (name is optional in backend)
- **Why**: Edge case — documents current server behaviour

**Test 6: Create registration with invalid email**
- **What**: Sends registration with malformed email "invalid-email"
- **Code**: `api.createRegistration(EVENT_ID, invalidRegistrationBadEmail)`
- **Assertions**: Status 201, response has `id`
- **Note**: Server does not validate email format — the test documents this current behaviour
- **Why**: Highlights a gap — email format is not validated server-side

**Test 7: Create registration for invalid event**
- **What**: Attempts to register for a non-existent event ID
- **Code**: `api.createRegistration(INVALID_EVENT_ID, validRegistration)`
- **Assertions**: Status 404, message contains "Event not found"
- **Why**: Verifies proper error handling for unknown events

---

### Describe Block: "Retrieve Event" (4 tests)

**Test 8: Retrieve valid event**
- **What**: GET event details for the valid event ID
- **Code**: `api.getEvent(EVENT_ID)`
- **Assertions**: Status 200, response has id, title, capacity, confirmed, placesRemaining
- **Why**: Verifies event retrieval endpoint works correctly

**Test 9: Retrieve invalid event**
- **What**: GET event for non-existent ID
- **Code**: `api.getEvent(INVALID_EVENT_ID)`
- **Assertions**: Status 404, message contains "Event not found"
- **Why**: Error handling for unknown events

**Test 10: Verify event availability**
- **What**: Creates a registration, then re-fetches the event to verify the attendee appears
- **Code**: GET event → create reg → GET event again → find attendee by email
- **Assertions**: Event `attendees` array contains the newly registered user
- **Why**: End-to-end verification that registration updates event state

**Test 11: Verify waiting-list count**
- **What**: Fills event capacity, adds a waiting guest, checks `waitListCount`
- **Code**: Loop to fill capacity, create waiting reg, GET event, assert `waitListCount >= 1`
- **Assertions**: `waitListCount` is at least 1
- **Why**: Verifies waitlist counter is accurate

---

### Describe Block: "Cancellation" (6 tests)

**Test 12: Cancel confirmed registration**
- **What**: Creates a confirmed registration, then cancels it
- **Code**: Create reg → extract `cancellationToken` → POST cancel → verify status is `cancelled`
- **Assertions**: Status 200, response has `cancelled` property, status is `cancelled`
- **Why**: Core cancellation functionality

**Test 13: Promote waiting guest after cancellation**
- **What**: Fills event capacity, adds waiting guest, cancels a confirmed registration, verifies next waiting guest is promoted
- **Code**: Fill capacity → create waiting reg → create another confirmed reg → cancel confirmed → check `promoted` field
- **Assertions**: `promoted` is defined, status is `confirmed`
- **Why**: Verifies the waitlist promotion workflow (most complex test)

**Test 14: Cancel waiting-list registration**
- **What**: Fills capacity, creates a waiting registration, cancels it, verifies waitlist count behaviour
- **Code**: Fill capacity → create waiting reg → cancel → GET event → check waitListCount
- **Assertions**: `waitListCount >= 0` after cancellation
- **Why**: Edge case — cancelling from waitlist should not trigger promotion

**Test 15: Cancel using invalid token**
- **What**: POST cancel with a clearly invalid token
- **Code**: `api.cancelRegistration(INVALID_TOKEN)`
- **Assertions**: Status 404, message contains "not found"
- **Why**: Security/error handling for invalid cancellation tokens

**Test 16: Cancel already cancelled registration**
- **What**: Cancels a registration twice
- **Code**: Create reg → cancel (200) → cancel again (200) → verify `cancelled` property exists
- **Note**: Server returns 200 on double-cancel (idempotent behaviour)
- **Why**: Tests idempotency of cancellation

**Test 17: Cancel with empty token**
- **What**: POST cancel with an empty string token
- **Code**: `api.cancelRegistration(EMPTY_TOKEN)`
- **Assertions**: Status 404
- **Why**: Edge case — empty input handling

---

### Describe Block: "Update Registration" (4 tests)

**Test 18: Update existing resource**
- **What**: Creates a registration, then PATCHes it with dietary and accessibility updates
- **Code**: Create reg → PATCH with `registrationPatchPayload` → verify fields updated
- **Assertions**: `dietaryRequirements` and `accessibilityNeeds` match patched values
- **Why**: Happy path for PATCH endpoint

**Test 19: Update with valid partial data**
- **What**: PATCHes only the `organisation` field, verifies other fields are preserved
- **Code**: Create reg → PATCH with `partialUpdatePayload` (org only) → verify org changed, dietary unchanged
- **Assertions**: Organisation updated; dietary and accessibility preserved from original
- **Why**: Verifies partial update behaviour (only specified fields change)

**Test 20: Update non-existent resource**
- **What**: PATCH a registration that doesn't exist (reg-999)
- **Code**: `api.updateRegistration(EVENT_ID, 'reg-999', registrationPatchPayload)`
- **Assertions**: Status 404, message contains "Registration not found"
- **Why**: Error handling

**Test 21: Update with invalid data**
- **What**: PATCHes a registration with `name` field (not an allowed updatable field)
- **Code**: Create reg → PATCH with `invalidUpdatePayload` (name: "New Name")
- **Assertions**: Status 400, message contains "Invalid fields"
- **Why**: Server only allows updates to `dietaryRequirements`, `accessibilityNeeds`, `organisation`, `marketingConsent` — name cannot be changed

---

## 5. What Each Test Does — Browser Tests (`browser.spec.ts`)

All browser tests are inside `test.describe.serial("Event Registration")` — run in order, sequential.

### Setup

`test.beforeEach` runs before every test:
1. Creates a new `IndexPage` instance
2. Navigates to the app (`indexPage.goto()`)
3. Verifies the main heading is visible (`indexPage.isHeadingVisible()`)

---

**Test 1: Register a guest with all valid details**
- **What**: Fills the registration form with complete valid data and submits
- **Code**: `indexPage.registerGuest(validRegistration)` → checks result contains "Thank you"
- **Assertions**: `registrationResult` contains the registrant's name and email
- **Why**: Happy path — end-to-end UI registration flow

**Test 2: Register a guest without marketing consent**
- **What**: Registers with `marketingConsent: false` (checkbox left unchecked)
- **Code**: Custom payload with no consent, calls `registerGuest()`
- **Assertions**: Registration is successful
- **Why**: Verifies that consent is optional and registration works without it

**Test 3: Show validation error for invalid email format**
- **What**: Fills in name and an invalid email (no `@`), submits
- **Code**: Directly fills fields, clicks submit → checks `emailFieldError`
- **Assertions**: Error message "Enter a valid email address" displayed
- **Why**: Client-side form validation — email format check

**Test 4: Show validation error for empty name**
- **What**: Submits form with empty name field
- **Code**: Fills empty name, valid email → submit → check `nameFieldError`
- **Assertions**: Error message "Enter your name" displayed
- **Why**: Client-side validation — required name field

**Test 5: Show validation error for empty email**
- **What**: Submits form with empty email field
- **Code**: Fills valid name, empty email → submit → check `emailFieldError`
- **Assertions**: Error message "Enter a valid email address" displayed
- **Why**: Client-side validation — required email field

**Test 6: Show registered details after registration**
- **What**: Registers a guest, opens test inbox, verifies confirmation message appears
- **Code**: Register → `openTestInbox()` → check heading "Test inbox", check message cards
- **Assertions**: `messageCards` count is 1 (initialMessageCount), first card contains email and name
- **Why**: Verifies the confirmation message appears in the test inbox after registration

**Test 7: Show registered details and Show all**
- **What**: Registers, opens inbox (shows 1 message), clicks "Show all", verifies all 5 messages appear
- **Code**: Register → open inbox → click showAllButton → check messageCards count is 5
- **Assertions**: Count changes from 1 to 5; last card contains registrant's email and name
- **Why**: Tests inbox filtering by email and the "Show all" feature

**Test 8: Show registered details and Cancel registration**
- **What**: Registers, opens inbox, cancels registration via UI, verifies cancellation and message remains
- **Code**: Register → open inbox → click cancel button → confirm cancel → verify cancellation message → check inbox still shows cancelled user's message
- **Assertions**: Cancel result contains "Registration cancelled"; message card for user still visible
- **Why**: End-to-end cancellation flow through the browser UI

---

## 6. Code Structure & Test Architecture Analysis

### Strengths
1. **Page Object Model** — Clean separation of concerns; test logic is free of DOM selectors
2. **Centralised Selectors** — Single source of truth for all locators in `e2e/selectors/index.ts`
3. **Serial Execution** — `test.describe.serial` correctly used for stateful workflows (cancellation, capacity fill)
4. **Reset Before Each** — API tests reset the store before every test for isolation
5. **Unique Test Data** — `randomEmail()` generates unique emails per call, reducing cross-test contamination
6. **Environment Configuration** — `.env` files for flexible environment setup
7. **Cross-Browser** — Chromium and WebKit projects configured
8. **Allure Reporting** — Detailed test reports with traces and screenshots
9. **Type Safety** — Full TypeScript with type checking

### Weaknesses
1. **Inconsistent API responses** — Tests 5 and 6 in "Create Registration" expect 201 for invalid data (no name, bad email), revealing the server doesn't validate these fields. Tests document this but don't flag it as a bug.
2. **Flaky timing** — Multiple tests rely on `waitListCount` checks after async operations without explicit waits
3. **Registration form scattered across IndexPage** — Registration form fields are managed in `IndexPage` rather than a dedicated page object; this is functional but blurs the single-responsibility principle
4. **Hard-coded IDs** — `reg-999` in "Update non-existent resource" is arbitrary
5. **Limited assertion depth** — Many tests check status codes and property existence but miss deeper state verification
6. **Email format validation gap** — Server accepts "invalid-email" as valid (Test 6 documents this behaviour)
7. **`test.describe.serial` blocks are sequential** — This slows execution but is necessary for stateful tests

---

## 7. What Could Be Improved (and Why)

### 7a. Playwright Fixtures — Implemented

**Fixtures added:**

The project now includes Playwright fixtures in `e2e/fixtures/test-fixtures.ts` with three reusable dependencies:

| Fixture | Purpose | Type |
|---|---|---|
| `indexPage` | Creates `IndexPage`, navigates to the app, verifies page loads | Browser fixture |
| `api` | Creates `ApiPage` using Playwright's built-in `request` fixture | API fixture |
| `resetStore` | Provides the existing application reset functionality (POST `/api/reset`) without changing when tests reset data | Shared fixture |

**Implementation details:**

```typescript
// e2e/fixtures/test-fixtures.ts
import { test as base, APIRequestContext } from '@playwright/test';
import { IndexPage } from '../pages/index.page';
import { ApiPage } from '../pages/api.pages';

type TestFixtures = {
  indexPage: IndexPage;
  api: ApiPage;
  resetStore: () => Promise<void>;
};

export const test = base.extend<TestFixtures>({
  indexPage: async ({ page }, use) => {
    const indexPage = new IndexPage(page);
    await indexPage.goto();
    await indexPage.isHeadingVisible();
    await use(indexPage);
  },

  api: async ({ request }, use) => {
    const api = new ApiPage(request);
    await use(api);
  },

  resetStore: async ({ request }, use) => {
    const api = new ApiPage(request);
    await use(async () => api.resetStore());
  },
});
```

**Why this improves your suite:**

Previously, tests had repeated setup such as:

```typescript
// Browser tests
let indexPage: IndexPage;
test.beforeEach(async ({ page }) => {
  indexPage = new IndexPage(page);
  await indexPage.goto();
  await indexPage.isHeadingVisible();
});

// API tests
let api: ApiPage;
test.beforeEach(async ({ request }) => {
  api = new ApiPage(request);
  await api.resetStore();
});
```

The fixtures centralise this setup. Tests now simply use:

```typescript
// Browser test — uses indexPage and explicit resetStore
test("Register a guest", async ({ indexPage, resetStore }) => {
  await resetStore();
  await indexPage.registerGuest(validRegistration);
});

// API test — uses api fixture directly
test("Create registration", async ({ api }) => {
  const response = await api.createRegistration(EVENT_ID, validRegistration);
  expect(response.status()).toBe(201);
});
```

**Important: Conservative refactor**

The refactor was deliberately conservative:

- **Reset is NOT automatic** for every test. This preserves existing explicit `await resetStore();` behaviour because the suite contains tests with specific state expectations (registration counts, inbox message counts, waiting-list behaviour, cancellation/promotion, sequential API scenarios). Making reset automatic could subtly change those tests.
- **Existing browser navigation and heading validation** are retained inside the `indexPage` fixture.
- **Validation**: Ran `npm run typecheck` after changes — `tsc --noEmit` passes.

### 7b. Improvements That Could Be Made

| Area | Improvement | Reason |
|---|---|---|
| **Error handling** | Add global error handler for API responses (check `response.ok()`) | Currently tests manually check status codes per test |
| **Custom assertions** | Create reusable assertion helpers like `expectRegistration(registration).toBeConfirmed()` | Reduces repetitive expect chains |
| **Type safety** | Type all API response bodies instead of `any`/`{ message: string }` | Better IDE support and compile-time safety |
| **Environment parity** | Standardise `.env` files across environments | `.env` is committed (risky), `.env.local` is gitignored — inconsistent |
| **Configuration** | Extract common config into shared interfaces | API URL, base URL scattered across multiple files |
| **Test separation** | Registration form fields are managed directly in `IndexPage` rather than a dedicated page object | Consider extracting form-specific interactions into a focused component if the form grows in complexity |
| **Data management** | Use deterministic email patterns instead of `randomEmail()` for traceability | Random emails make debugging harder; traceability matters |
| **API response validation** | Add JSON schema validation for API responses | Catches unexpected response shape changes |

---

## 8. Tests That Could Be Added — API (`api.spec.ts`)

### 8a. Health Check Endpoint
```typescript
test("Health check returns ok", async ({ request }) => {
  const response = await new ApiPage(request).getHealth();
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.status).toBe('ok');
});
```
**Why**: Validates the application is alive; essential smoke test.

### 8b. Events List Endpoint
```typescript
test("List events returns array with correct event", async ({ request }) => {
  const response = await new ApiPage(request).getEvents();
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.length).toBeGreaterThan(0);
  expect(body[0].id).toBe(EVENT_ID);
});
```
**Why**: Tests the events listing endpoint which is completely untested.

### 8c. Messages Endpoint
```typescript
test("Messages endpoint returns confirmation message", async ({ request }) => {
  const api = new ApiPage(request);
  await api.resetStore();
  await api.createRegistration(EVENT_ID, validRegistration);
  const response = await api.getMessages();
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.length).toBeGreaterThan(0);
  expect(body[0].subject).toBe('Your event place is confirmed');
});
```
**Why**: `/api/messages` is used by browser tests but has zero API test coverage.

### 8d. Create Registration — Marketing Consent Default
```typescript
test("Create registration with marketingConsent omitted defaults to false", async () => {
  const payload = { name: 'No Consent', email: randomEmail('consent') };
  const response = await api.createRegistration(EVENT_ID, payload);
  expect(response.status()).toBe(201);
  const body = await response.json();
  expect(body.marketingConsent).toBe(false);
});
```
**Why**: OpenAPI spec says `marketingConsent` has `default: false`; should be verified.

### 8e. Create Registration — Name Length Validation
```typescript
test("Create registration with name exceeding 100 chars returns 400", async () => {
  const longName = 'A'.repeat(101);
  const response = await api.createRegistration(EVENT_ID, { ...validRegistration, name: longName });
  expect(response.status()).toBe(400);
});
```
**Why**: OpenAPI spec defines `maxLength: 100` for name; server doesn't enforce it.

### 8f. Update Registration — Toggle Marketing Consent
```typescript
test("Update registration marketing consent", async () => {
  // Create, then PATCH marketingConsent: false
  // Verify it changed
});
```
**Why**: `marketingConsent` is in the allowed update fields but untested.

### 8g. Create Registration — Organisation and Accessibility Fields
```typescript
test("Create registration with organisation and accessibility needs", async () => {
  // Verify all optional fields are persisted correctly
});
```
**Why**: Only Test 1 covers all fields together; individual optional fields need verification.

### 8h. Cancellation — Verify Promoted User Receives Message
```typescript
test("Promoted user receives promotion message in inbox", async () => {
  // Fill event, cancel confirmed registration
  // GET /api/messages, verify promoted user has "A place is now available" message
});
```
**Why**: Tests the message creation for promotions, which is a critical user journey.

### 8i. Registration — Verify Created Registration Is Persisted
```typescript
test("Verify registration appears in GET registrations", async () => {
  // Create registration, then call GET registrations endpoint
  // Verify it appears in the list
});
```
**Why**: There's a GET registrations endpoint not covered by tests.

---

## 9. Tests That Could Be Added — Browser (`browser.spec.ts`)

### 9a. Event Page — Availability Card Displays Correctly
```typescript
test("Availability card shows correct places remaining", async ({ page }) => {
  await indexPage.resetStore();
  // Verify availability card shows "3 places remaining" and "0 currently waiting"
  await expect(indexPage.availabilityNumber).toHaveText('3');
});
```
**Why**: The availability card is a key UI element that's never verified.

### 9b. Event Page — Event Details Are Visible
```typescript
test("Event details are displayed correctly", async ({ page }) => {
  await indexPage.resetStore();
  await expect(indexPage.eventHeading).toContainText('The Human Future of Work');
  await expect(indexPage.eventDetails).toContainText('The Foundry, Leeds');
  await expect(indexPage.eventLede).toContainText('practical one-day forum');
});
```
**Why**: Core content verification for the landing page.

### 9c. Registration — Confirmation Message Based on Status
```typescript
test("Waiting list registration shows waiting list message", async ({ page }) => {
  // Fill event capacity via API, then register another user via UI
  // Verify result shows "You are on the waiting list" instead of "You are registered"
});
```
**Why**: The browser test only verifies successful confirmed registration; the waitlist UI flow is untested.

### 9d. Navigation — Inbox Link Navigation
```typescript
test("Navigation link to inbox works correctly", async ({ page }) => {
  await indexPage.resetStore();
  await indexPage.inboxLink.click();
  await expect(indexPage.inboxHeading).toContainText('Test inbox');
});
```
**Why**: Navigation links are not exercised by any existing test.

### 9e. Cancellation — Cancel via Email-Specific Inbox View
```typescript
test("Cancel from filtered inbox view", async ({ page }) => {
  // Register user, open inbox filtered by email, cancel from there
  // Verify cancellation succeeds from filtered view
});
```
**Why**: Tests cancellation from the email-filtered inbox view (current test cancels from "Show all" view).

### 9f. Registration — Error Message Display on Failed Registration
```typescript
test("API error is displayed on failed registration", async ({ page }) => {
  // Fill form with duplicate email (after reset), submit
  // Verify error message from API is shown in #registration-result
});
```
**Why**: Server-side errors (409, 400) are not verified in the UI.

### 9g. Cross-Browser — Firefox Testing
```typescript
// Add a firefox project in playwright.config.ts
{ name: 'firefox', testIgnore: /api\.spec\.ts/, use: { ...devices['Desktop Firefox'] } }
```
**Why**: README mentions cross-browser support; Firefox is a common target browser.

### 9h. Accessibility — Run Axe Core
```typescript
test("Page has no accessibility violations", async ({ page }) => {
  await indexPage.goto();
  const accessibilityAudit = await new AxeBuilder({ page }).analyze();
  expect(accessibilityAudit.violations).toEqual([]);
});
```
**Why**: `@axe-core/playwright` is already a dependency; accessibility (WCAG 2.2 AA) is a product requirement but completely untested.

### 9i. Responsive — Mobile Viewport
```typescript
test("Registration form works on mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await indexPage.resetStore();
  await indexPage.registerGuest(validRegistration);
  await indexPage.isRegistrationSuccessful();
});
```
**Why**: iPhone Safari is a target platform; responsive behaviour is untested.

---

## 10. Quick Reference: Running Tests

```bash
# Run all tests
npm test

# Run only API tests
npx playwright test api.spec.ts

# Run only Browser tests
npx playwright test browser.spec.ts

# Run in UI mode (interactive)
npm run test:ui

# Run in CI mode (parallel + retries)
npm run test:ci

# Run in headed mode for demo
npx playwright test --headed

# Generate Allure report
npm run allure:generate && npm run allure:open

# Start application server only
npm start

# Type check
npm run typecheck
```

---

## 11. Test Coverage Summary

| Feature | API Tests | Browser Tests | Gap |
|---|---|---|---|
| Health check | No | No | Add API smoke test |
| Event listing | No | No | Add API test |
| Event retrieval | Yes | No | Browser: event page details |
| Registration create (valid) | Yes | Yes | — |
| Registration create (invalid) | Partial | Yes | API: no server-side email/name validation |
| Duplicate prevention | Yes | No | Add browser duplicate test |
| Capacity/waitlist | Yes | No | Add browser waitlist flow |
| Cancellation | Yes | Yes | — |
| Promotion | Yes | No | Add browser promotion view |
| Update | Yes | No | Add browser update flow |
| Messages | No | Yes | Add API messages test |
| Navigation | No | Partial | Add nav link tests |
| Accessibility | No | No | Add Axe audit |
| Responsive | No | No | Add mobile test |

---

## 12. Migration: Hooks → Playwright Fixtures (2026-09-12)

### Summary

Refactored test setup from inline `test.beforeEach` hooks to Playwright fixtures in `e2e/fixtures/test-fixtures.ts`.

### Before (Hooks)

**Browser tests** (`browser.spec.ts`):
```typescript
let indexPage: IndexPage;
test.beforeEach(async ({ page }) => {
  indexPage = new IndexPage(page);
  await indexPage.goto();
  await indexPage.isHeadingVisible();
});
```

**API tests** (`api.spec.ts`):
```typescript
let api: ApiPage;
test.beforeEach(async ({ request }) => {
  api = new ApiPage(request);
  await api.resetStore();
});
```

### After (Fixtures)

**`e2e/fixtures/test-fixtures.ts`** — three reusable fixtures:
| Fixture | Purpose |
|---|---|
| `indexPage` | Creates `IndexPage`, navigates, verifies heading |
| `api` | Creates `ApiPage` from Playwright's `request` |
| `resetStore` | Function calling `POST /api/reset` |

**Tests now use:**
```typescript
// Browser
test("Register a guest", async ({ indexPage, resetStore }) => {
  await resetStore();
  await indexPage.registerGuest(validRegistration);
});

// API
test("Create registration", async ({ api }) => {
  const response = await api.createRegistration(EVENT_ID, validRegistration);
  expect(response.status()).toBe(201);
});
```

### Design Decisions

- **No automatic reset**: `resetStore` is a function tests call explicitly. Preserves existing behaviour where tests have specific state expectations (registration counts, inbox messages, waitlist, cancellation/promotion, sequential API scenarios).
- **Heading validation retained**: `indexPage` fixture includes navigation + heading check.
- **Type-safe**: Full TypeScript typing on all fixtures.
- **Validation**: `npm run typecheck` passes; all 37 tests pass.

### Files Changed

- **Added**: `e2e/fixtures/test-fixtures.ts`, `e2e/fixtures/README.md`
- **Modified**: `e2e/tests/browser.spec.ts`, `e2e/tests/api.spec.ts`
- **Updated**: `README.md` (project structure, architecture highlights, features)
- **Updated**: `demo-notes.md` (this section)
