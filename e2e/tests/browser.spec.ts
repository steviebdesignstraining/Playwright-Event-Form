import { expect, test } from "../fixtures/test-fixtures.js";
import {
  invalidRegistrationBadEmail,
  invalidRegistrationEmptyEmail,
  invalidRegistrationEmptyName,
  validRegistration,
} from "../test-data/apiTestdata.data.ts";
import {
  invalidEmailFormatErrorMessage,
  emptyNameErrorMessage,
  noConsentUserEmail,
  noConsentUserName,
  testInboxHeading,
  registrationCancelledMessage,
  initialMessageCount,
  allMessagesCount,
} from "../test-data/registration.data.ts";

test.describe.serial("Event Registration", () => {
  test("Register a guest with all valid details", async ({
    indexPage,
    resetStore,
  }) => {
    await resetStore();
    await indexPage.registerGuest(validRegistration);
    await indexPage.isRegistrationSuccessful();
    await expect(indexPage.registrationResult).toContainText(
      validRegistration.name,
    );
    await expect(indexPage.registrationResult).toContainText(
      validRegistration.email,
    );
  });

  test("Register a guest without marketing consent", async ({
    indexPage,
    resetStore,
  }) => {
    await resetStore();
    await indexPage.registerGuest({
      name: noConsentUserName,
      email: noConsentUserEmail,
      marketingConsent: false,
    });
    await indexPage.isRegistrationSuccessful();
  });

  test("Show validation error for invalid email format", async ({
    indexPage,
  }) => {
    await indexPage.nameField.fill(invalidRegistrationBadEmail.name);
    await indexPage.emailField.fill(invalidRegistrationBadEmail.email);
    // await indexPage.submitButton.click();
    await expect(indexPage.emailFieldError).toContainText(
      invalidEmailFormatErrorMessage,
    );
  });

  test("Show validation error for empty name", async ({ indexPage }) => {
    await indexPage.nameField.fill(invalidRegistrationEmptyName.name);
    await indexPage.emailField.fill(invalidRegistrationEmptyName.email);
    await indexPage.submitButton.click();
    await expect(indexPage.nameFieldError).toContainText(emptyNameErrorMessage);
  });

  test("Show validation error for empty email", async ({ indexPage }) => {
    await indexPage.nameField.fill(invalidRegistrationEmptyEmail.name);
    await indexPage.emailField.fill(invalidRegistrationEmptyEmail.email);
    await indexPage.submitButton.click();
    await expect(indexPage.emailFieldError).toContainText(
      invalidEmailFormatErrorMessage,
    );
  });

  test("Show registed details after registration", async ({
    indexPage,
    resetStore,
  }) => {
    await resetStore();
    await indexPage.registerGuest(validRegistration);
    await indexPage.isRegistrationSuccessful();
    await indexPage.openTestInbox();
    await expect(indexPage.inboxHeading).toContainText(testInboxHeading);
    await expect(indexPage.messageCards).toHaveCount(initialMessageCount);
    await expect(indexPage.messageCards.first()).toContainText(
      validRegistration.email,
    );
    await expect(indexPage.messageCards.first()).toContainText(
      validRegistration.name,
    );
  });
  test("Show registed details after registration and Show all", async ({
    indexPage,
    resetStore,
  }) => {
    await resetStore();
    await indexPage.registerGuest(validRegistration);
    await indexPage.isRegistrationSuccessful();
    await indexPage.openTestInbox();
    await expect(indexPage.inboxHeading).toContainText(testInboxHeading);
    await expect(indexPage.messageCards).toHaveCount(initialMessageCount);
    await indexPage.showAllButton.click();
    await expect(indexPage.inboxHeading).toContainText(testInboxHeading);
    await expect(indexPage.messageCards).toHaveCount(allMessagesCount);
    await expect(indexPage.messageCards.last()).toContainText(
      validRegistration.email,
    );
    await expect(indexPage.messageCards.last()).toContainText(
      validRegistration.name,
    );
  });
  test("Show registed details after registration and Cancel registration", async ({
    indexPage,
    resetStore,
  }) => {
    await resetStore();
    await indexPage.registerGuest(validRegistration);
    await indexPage.isRegistrationSuccessful();
    await indexPage.openTestInbox();
    await expect(indexPage.inboxHeading).toContainText(testInboxHeading);
    await expect(indexPage.messageCards).toHaveCount(initialMessageCount);
    await indexPage.cancelRegistrationButton.click();
    await expect(indexPage.confirmCancelButton).toBeVisible();
    await indexPage.confirmCancelButton.click();
    await expect(indexPage.cancelResult).toContainText(
      registrationCancelledMessage,
    );
    await indexPage.testInboxButton.click();
    await expect(
      indexPage.messageCards
        .filter({ hasText: validRegistration.email })
        .first(),
    ).toContainText(validRegistration.email);
    await expect(
      indexPage.messageCards
        .filter({ hasText: validRegistration.email })
        .first(),
    ).toContainText(validRegistration.name);
  });
});
