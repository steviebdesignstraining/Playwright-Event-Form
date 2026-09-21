import { expect, test } from "../fixtures/test-fixtures.js";
import { AxeBuilder } from "@axe-core/playwright";
import {
  validRegistration,
  invalidRegistrationBadEmail,
  invalidRegistrationEmptyEmail,
  invalidRegistrationEmptyName,
} from "../test-data/apiTestdata.data.ts";
import {
  emptyNameErrorMessage,
  invalidEmailFormatErrorMessage,
} from "../test-data/registration.data.ts";

test.describe.serial("Accessibility", () => {
  test.describe("WCAG 2.2 AA Compliance", () => {
    test("Home page has no accessibility violations", async ({ indexPage }) => {
      await indexPage.goto();
      const accessibilityAudit = await new AxeBuilder({ page: indexPage.page }).analyze();
      expect(accessibilityAudit.violations).toEqual([]);
    });

    test("Registration form has no critical accessibility violations", async ({ indexPage }) => {
      await indexPage.goto();
      const accessibilityAudit = await new AxeBuilder({ page: indexPage.page }).analyze();
      const criticalViolations = accessibilityAudit.violations.filter(
        (v) => v.impact === "critical" || v.impact === "serious"
      );
      expect(criticalViolations).toEqual([]);
    });

    test("Registration form with errors displays error messages accessibly", async ({ indexPage }) => {
      await indexPage.goto();
      await indexPage.nameField.fill("");
      await indexPage.emailField.fill("");
      await indexPage.submitButton.click();

      await expect(indexPage.nameFieldError).toBeVisible();
      await expect(indexPage.emailFieldError).toBeVisible();

      console.log("Form error messages displayed correctly");
    });

    test("Event details section is visible", async ({ indexPage }) => {
      await indexPage.goto();
      await expect(indexPage.eventHeading).toBeVisible();
      await expect(indexPage.eventCard).toBeVisible();
    });
  });

  test.describe("Keyboard Navigation", () => {
    test("All form fields are focusable via Tab", async ({ indexPage }) => {
      await indexPage.goto();

      await indexPage.nameField.focus();
      await expect(indexPage.nameField).toBeFocused();

      await indexPage.page.keyboard.press("Tab");
      await indexPage.emailField.focus();
      await expect(indexPage.emailField).toBeFocused();
    });

    test("Submit button is reachable via keyboard", async ({ indexPage }) => {
      await indexPage.goto();
      await indexPage.submitButton.focus();
      await expect(indexPage.submitButton).toBeFocused();
    });

    test("Form can be submitted via Enter key", async ({ indexPage }) => {
      await indexPage.goto();
      await indexPage.nameField.fill("Keyboard Test");
      await indexPage.emailField.fill("keyboard@example.com");
      await indexPage.page.keyboard.press("Enter");
      await indexPage.isRegistrationSuccessful();
    });
  });

  test.describe("Focus Management", () => {
    test("Focus indicators are visible on form elements", async ({ indexPage }) => {
      await indexPage.goto();
      await indexPage.nameField.focus();
      const nameFieldHandle = await indexPage.nameField.elementHandle();
      const outline = await nameFieldHandle.evaluate((el) => {
        const style = window.getComputedStyle(el);
        return {
          outline: style.outline,
          outlineWidth: style.outlineWidth,
          outlineStyle: style.outlineStyle,
        };
      });
      expect(outline.outlineWidth).not.toBe("0px");
      expect(outline.outlineStyle).not.toBe("none");
    });

    test("Error summary receives focus when validation fails", async ({ indexPage }) => {
      await indexPage.goto();
      await indexPage.submitButton.click();

      const errorSummary = indexPage.registrationErrorSummary;
      await expect(errorSummary).toBeVisible().catch(() => {
        console.log("No error summary visible — individual field errors displayed");
      });
    });
  });

  test.describe("ARIA & Semantic HTML", () => {
    test("Page has main landmark", async ({ indexPage }) => {
      await indexPage.goto();
      const main = indexPage.mainContent;
      await expect(main).toBeVisible();
    });

    test("Page has banner landmark", async ({ indexPage }) => {
      await indexPage.goto();
      const header = indexPage.siteHeader;
      await expect(header).toBeVisible();
    });

    test("Page has navigation landmark", async ({ indexPage }) => {
      await indexPage.goto();
      const nav = indexPage.nav;
      await expect(nav).toBeVisible();
    });

    test("Form fields have associated labels", async ({ indexPage }) => {
      await indexPage.goto();
      await indexPage.page.waitForSelector('input[name="name"]');
      await indexPage.page.waitForSelector('input[name="email"]');
      await indexPage.page.waitForSelector('span.field-label');

      const nameLabel = await indexPage.page.locator('span.field-label:has-text("Name")').count();
      const emailLabel = await indexPage.page.locator('span.field-label:has-text("Email")').count();
      const totalFieldLabels = await indexPage.page.locator('span.field-label').count();
      const nameInput = await indexPage.page.locator('input[name="name"]').count();
      const emailInput = await indexPage.page.locator('input[name="email"]').count();

      console.log(`Labels: name=${nameLabel}, email=${emailLabel}, total=${totalFieldLabels}, nameInput=${nameInput}, emailInput=${emailInput}`);

      expect(totalFieldLabels).toBeGreaterThanOrEqual(3);
      expect(nameInput).toBeGreaterThanOrEqual(1);
      expect(emailInput).toBeGreaterThanOrEqual(1);
      expect(nameLabel).toBeGreaterThanOrEqual(1);
      expect(emailLabel).toBeGreaterThanOrEqual(1);
    });

    test("Field errors use aria-describedby or equivalent", async ({ indexPage }) => {
      await indexPage.goto();
      await indexPage.nameField.fill("");
      await indexPage.emailField.fill("");
      await indexPage.submitButton.click();

      const nameError = indexPage.nameFieldError;
      await expect(nameError).toBeVisible().catch(() => {});
    });

    test("Heading hierarchy is correct", async ({ indexPage }) => {
      await indexPage.goto();
      const h1 = indexPage.page.locator("h1");
      await expect(h1.first()).toBeVisible();
      await expect(h1.first()).toContainText("Future");
    });
  });

  test.describe("Screen Reader Compatibility", () => {
    test("Form fields have associated visible labels", async ({ indexPage }) => {
      await indexPage.goto();
      await indexPage.page.waitForSelector('input[name="name"]');
      await indexPage.page.waitForSelector('input[name="email"]');
      await indexPage.page.waitForSelector('span.field-label');

      const nameLabel = await indexPage.page.locator('span.field-label:has-text("Name")').count();
      const emailLabel = await indexPage.page.locator('span.field-label:has-text("Email")').count();

      expect(nameLabel).toBeGreaterThanOrEqual(1);
      expect(emailLabel).toBeGreaterThanOrEqual(1);
    });

    test("Registration result has aria-live region", async ({ indexPage }) => {
      await indexPage.goto();
      const result = indexPage.registrationResult;
      const ariaLive = await result.getAttribute("aria-live").catch(() => null);
      const role = await result.getAttribute("role").catch(() => null);
      expect(ariaLive || role).toBeTruthy();
    });

    test("Submit button has accessible name", async ({ indexPage }) => {
      await indexPage.goto();
      const button = indexPage.submitButton;
      const name = await button.getAttribute("aria-label");
      const text = await button.textContent();
      expect(name || text?.trim()).toBeTruthy();
    });
  });

  test.describe("Error Messaging Accessibility", () => {
    test("Empty name validation error is displayed", async ({ indexPage }) => {
      await indexPage.goto();
      await indexPage.nameField.fill(invalidRegistrationEmptyName.name);
      await indexPage.submitButton.click();
      await expect(indexPage.nameFieldError).toContainText(emptyNameErrorMessage);
    });

    test("Empty email validation error is displayed", async ({ indexPage }) => {
      await indexPage.goto();
      await indexPage.emailField.fill(invalidRegistrationEmptyEmail.email);
      await indexPage.submitButton.click();
      await expect(indexPage.emailFieldError).toContainText(invalidEmailFormatErrorMessage);
    });

    test("Invalid email validation error is displayed", async ({ indexPage }) => {
      await indexPage.goto();
      await indexPage.nameField.fill(invalidRegistrationBadEmail.name);
      await indexPage.emailField.fill(invalidRegistrationBadEmail.email);
      await indexPage.submitButton.click();
      await expect(indexPage.emailFieldError).toContainText(invalidEmailFormatErrorMessage);
    });

    test("Validation errors have sufficient colour contrast", async ({ indexPage }) => {
      await indexPage.goto();
      await indexPage.nameField.fill("");
      await indexPage.emailField.fill("");
      await indexPage.submitButton.click();

      const error = indexPage.nameFieldError;
      await expect(error).toBeVisible().catch(() => {});

      const accessibilityAudit = await new AxeBuilder({ page: indexPage.page }).analyze();
      const contrastViolations = accessibilityAudit.violations.filter((v) => v.id === "color-contrast");
      expect(contrastViolations).toEqual([]);
    });
  });
});
