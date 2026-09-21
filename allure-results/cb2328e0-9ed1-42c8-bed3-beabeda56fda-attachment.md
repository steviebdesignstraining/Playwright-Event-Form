# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: browser.spec.ts >> Event Registration >> Show registed details after registration and Cancel registration
- Location: e2e/tests/browser.spec.ts:103:3

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('link', { name: 'Open the test inbox' })

```

# Page snapshot

```yaml
- generic [ref=f2e1]:
  - banner [ref=f2e2]:
    - link "Future Forum" [ref=f2e3] [cursor=pointer]:
      - /url: /
    - navigation "Primary navigation" [ref=f2e4]:
      - link "Event" [ref=f2e5] [cursor=pointer]:
        - /url: /
      - link "Test inbox" [ref=f2e6] [cursor=pointer]:
        - /url: /inbox
      - link "API docs" [ref=f2e7] [cursor=pointer]:
        - /url: /api-docs
  - main [ref=f2e8]:
    - generic [ref=f2e9]:
      - heading "Cancel your registration" [level=1] [ref=f2e10]
      - paragraph [ref=f2e11]: This will release your event place.
      - button "Confirm cancellation" [active] [ref=f2e12] [cursor=pointer]
      - generic [ref=f2e13]:
        - heading "Registration cancelled" [level=2] [ref=f2e14]
        - paragraph [ref=f2e15]: Your place has been released.
```

# Test source

```ts
  19  | } from "../test-data/registration.data.ts";
  20  | 
  21  | test.describe.serial("Event Registration", () => {
  22  |   test("Register a guest with all valid details", async ({ indexPage, resetStore }) => {
  23  |     await resetStore();
  24  |     await indexPage.registerGuest(validRegistration);
  25  |     await indexPage.isRegistrationSuccessful();
  26  |     await expect(indexPage.registrationResult).toContainText(
  27  |       validRegistration.name,
  28  |     );
  29  |     await expect(indexPage.registrationResult).toContainText(
  30  |       validRegistration.email,
  31  |     );
  32  |   });
  33  | 
  34  |   test("Register a guest without marketing consent", async ({ indexPage, resetStore }) => {
  35  |     await resetStore();
  36  |     await indexPage.registerGuest({
  37  |       name: noConsentUserName,
  38  |       email: noConsentUserEmail,
  39  |       marketingConsent: false,
  40  |     });
  41  |     await indexPage.isRegistrationSuccessful();
  42  |   });
  43  | 
  44  |   test("Show validation error for invalid email format", async ({ indexPage }) => {
  45  |     await indexPage.nameField.fill(invalidRegistrationBadEmail.name);
  46  |     await indexPage.emailField.fill(invalidRegistrationBadEmail.email);
  47  |     await indexPage.submitButton.click();
  48  |     await expect(indexPage.emailFieldError).toContainText(
  49  |       invalidEmailFormatErrorMessage,
  50  |     );
  51  |   });
  52  | 
  53  |   test("Show validation error for empty name", async ({ indexPage }) => {
  54  |     await indexPage.nameField.fill(invalidRegistrationEmptyName.name);
  55  |     await indexPage.emailField.fill(invalidRegistrationEmptyName.email);
  56  |     await indexPage.submitButton.click();
  57  |     await expect(indexPage.nameFieldError).toContainText(emptyNameErrorMessage);
  58  |   });
  59  | 
  60  |   test("Show validation error for empty email", async ({ indexPage }) => {
  61  |     await indexPage.nameField.fill(invalidRegistrationEmptyEmail.name);
  62  |     await indexPage.emailField.fill(invalidRegistrationEmptyEmail.email);
  63  |     await indexPage.submitButton.click();
  64  |     await expect(indexPage.emailFieldError).toContainText(
  65  |       invalidEmailFormatErrorMessage,
  66  |     );
  67  |   });
  68  | 
  69  |   test("Show registed details after registration", async ({ indexPage, resetStore }) => {
  70  |     await resetStore();
  71  |     await indexPage.registerGuest(validRegistration);
  72  |     await indexPage.isRegistrationSuccessful();
  73  |     await indexPage.openTestInbox();
  74  |     await expect(indexPage.inboxHeading).toContainText(testInboxHeading);
  75  |     await expect(indexPage.messageCards).toHaveCount(initialMessageCount);
  76  |     await expect(indexPage.messageCards.first()).toContainText(
  77  |       validRegistration.email,
  78  |     );
  79  |     await expect(indexPage.messageCards.first()).toContainText(
  80  |       validRegistration.name,
  81  |     );
  82  |   });
  83  |   test("Show registed details after registration and Show all", async ({
  84  |     indexPage,
  85  |     resetStore,
  86  |   }) => {
  87  |     await resetStore();
  88  |     await indexPage.registerGuest(validRegistration);
  89  |     await indexPage.isRegistrationSuccessful();
  90  |     await indexPage.openTestInbox();
  91  |     await expect(indexPage.inboxHeading).toContainText(testInboxHeading);
  92  |     await expect(indexPage.messageCards).toHaveCount(initialMessageCount);
  93  |     await indexPage.showAllButton.click();
  94  |     await expect(indexPage.inboxHeading).toContainText(testInboxHeading);
  95  |     await expect(indexPage.messageCards).toHaveCount(allMessagesCount);
  96  |     await expect(indexPage.messageCards.last()).toContainText(
  97  |       validRegistration.email,
  98  |     );
  99  |     await expect(indexPage.messageCards.last()).toContainText(
  100 |       validRegistration.name,
  101 |     );
  102 |   });
  103 |   test("Show registed details after registration and Cancel registration", async ({
  104 |     indexPage,
  105 |     resetStore,
  106 |   }) => {
  107 |     await resetStore();
  108 |     await indexPage.registerGuest(validRegistration);
  109 |     await indexPage.isRegistrationSuccessful();
  110 |     await indexPage.openTestInbox();
  111 |     await expect(indexPage.inboxHeading).toContainText(testInboxHeading);
  112 |     await expect(indexPage.messageCards).toHaveCount(initialMessageCount);
  113 |     await indexPage.cancelRegistrationButton.click();
  114 |     await expect(indexPage.confirmCancelButton).toBeVisible();
  115 |     await indexPage.confirmCancelButton.click();
  116 |     await expect(indexPage.cancelResult).toContainText(
  117 |       registrationCancelledMessage,
  118 |     );
> 119 |     await indexPage.testInboxButton.click();
      |                                     ^ Error: locator.click: Test timeout of 30000ms exceeded.
  120 |     await expect(indexPage.messageCards.filter({ hasText: validRegistration.email }).first()).toContainText(
  121 |       validRegistration.email,
  122 |     );
  123 |     await expect(indexPage.messageCards.filter({ hasText: validRegistration.email }).first()).toContainText(
  124 |       validRegistration.name,
  125 |     );
  126 |   });
  127 | });
  128 | 
```