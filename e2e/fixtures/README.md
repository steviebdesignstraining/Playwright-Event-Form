# Playwright Fixtures

This directory contains reusable Playwright fixtures for the test suite.

## Fixtures

### `indexPage`
Creates an `IndexPage` instance, navigates to the application base URL, and verifies the main heading is visible.

**Type:** Browser fixture (requires `page`)

```typescript
test("Register a guest", async ({ indexPage, resetStore }) => {
  await resetStore();
  await indexPage.registerGuest(validRegistration);
});
```

### `api`
Creates an `ApiPage` instance using Playwright's built-in `request` fixture for API testing.

**Type:** API fixture (requires `request`)

```typescript
test("Create registration", async ({ api }) => {
  const response = await api.createRegistration(EVENT_ID, validRegistration);
  expect(response.status()).toBe(201);
});
```

### `resetStore`
Provides a function that calls the application's reset endpoint (`POST /api/reset`). This preserves the existing explicit reset behaviour — tests must call `await resetStore()` when they need a clean state.

**Type:** Shared fixture (requires `request`)

```typescript
test("Register a guest", async ({ indexPage, resetStore }) => {
  await resetStore(); // Explicit reset when needed
  await indexPage.registerGuest(validRegistration);
});
```

## Usage

Import the extended `test` and `expect` from the fixtures file:

```typescript
import { test, expect } from '../fixtures/test-fixtures';

test.describe('Event Registration', () => {
  test('Register a guest', async ({ indexPage, resetStore }) => {
    await resetStore();
    await indexPage.registerGuest(validRegistration);
  });
});
```

## Design Notes

- **No automatic reset**: The `resetStore` fixture is a function that tests call explicitly. This preserves existing test behaviour where specific state expectations exist (registration counts, inbox messages, waitlist behaviour, cancellation/promotion flows).
- **Heading validation**: The `indexPage` fixture includes the navigation and heading visibility check that was previously in `beforeEach` blocks.
- **Type-safe**: Fixtures are fully typed with TypeScript.