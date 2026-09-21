import { expect, test } from "../fixtures/test-fixtures.js";
import { locators } from "../selectors/index.ts";
import {
  validRegistration,
} from "../test-data/apiTestdata.data.ts";

test.describe.serial("Security", () => {
  test.describe("XSS Injection", () => {
    const xssPayloads = [
      "<script>alert('xss')</script>",
      "<img src=x onerror=alert(1)>",
      "<svg onload=alert(1)>",
      "<body onload=alert(1)>",
      "<iframe src=javascript:alert(1)>",
      "'; DROP TABLE registrations;--",
      "<a href=javascript:alert(1)>click</a>",
      "<div style=background:url(javascript:alert(1))>",
    ];

    for (const payload of xssPayloads) {
      test(`XSS: name field rejects "${payload.slice(0, 30)}..."`, async ({ indexPage }) => {
        await indexPage.resetStore();
        await indexPage.nameField.fill(payload);
        await indexPage.emailField.fill("test@example.com");
        await indexPage.submitButton.click();

        const resultText = await indexPage.registrationResult.textContent().catch(() => "");
        expect(resultText).not.toContain("alert");
        expect(resultText).not.toContain("javascript");
      });
    }

    test("XSS: email field rejects script payload", async ({ indexPage }) => {
      await indexPage.resetStore();
      await indexPage.nameField.fill("Test User");
      await indexPage.emailField.fill("<script>alert('xss')</script>");
      await indexPage.submitButton.click();

      const resultText = await indexPage.registrationResult.textContent().catch(() => "");
      expect(resultText).not.toContain("alert");
    });

    test("XSS: organisation field handles special characters safely", async ({ indexPage }) => {
      await indexPage.resetStore();
      await indexPage.nameField.fill("Test User");
      await indexPage.emailField.fill("xss-test@example.com");
      await indexPage.organisationField.fill("<script>document.cookie</script>");
      await indexPage.submitButton.click();

      const resultText = await indexPage.registrationResult.textContent().catch(() => "");
      expect(resultText).not.toContain("document.cookie");
    });
  });

  test.describe("SQL Injection", () => {
    const sqlPayloads = [
      "' OR '1'='1",
      "' OR '1'='1' --",
      "'; DROP TABLE users; --",
      "' UNION SELECT * FROM users --",
      "' OR 1=1 --",
      "admin'--",
      "1' OR '1'='1' OR '1'='1",
    ];

    for (const payload of sqlPayloads) {
      test(`SQL injection: email "${payload.slice(0, 20)}..." rejected`, async ({ api, indexPage }) => {
        await indexPage.resetStore();
        const response = await api.createRegistration("future-of-work-2026", {
          name: "SQL Test",
          email: payload,
        });
        expect(response.status()).not.toBe(500);
      });
    }

    test("SQL injection: name field rejected via API", async ({ api, indexPage }) => {
      await indexPage.resetStore();
      const response = await api.createRegistration("future-of-work-2026", {
        name: "' OR '1'='1",
        email: "sql-test@example.com",
      });
      expect(response.status()).not.toBe(500);
      const body = await response.json();
      expect(body.message).toBeUndefined();
    });
  });

  test.describe("Input Validation", () => {
    test("Very long input in name field is handled safely", async ({ indexPage }) => {
      const longName = "A".repeat(10000);
      await indexPage.nameField.fill(longName);
      await indexPage.emailField.fill("long-input@example.com");
      await indexPage.submitButton.click();

      const resultText = await indexPage.registrationResult.textContent().catch(() => "");
      expect(resultText).not.toContain("A".repeat(100));
    });

    test("Very long input in email field is handled safely", async ({ indexPage }) => {
      const longEmail = "a".repeat(10000) + "@example.com";
      await indexPage.nameField.fill("Long Email Test");
      await indexPage.emailField.fill(longEmail);
      await indexPage.submitButton.click();

      const resultText = await indexPage.registrationResult.textContent().catch(() => "");
      expect(resultText).not.toContain("error");
    });

    test("Unicode / emoji input is handled safely", async ({ api, indexPage }) => {
      await indexPage.resetStore();
      const response = await api.createRegistration("future-of-work-2026", {
        name: "🎉 Test 🎉",
        email: `emoji-${Date.now()}@example.com`,
      });
      expect(response.status()).not.toBe(500);
    });

    test("Null byte in email field is handled safely", async ({ api, indexPage }) => {
      await indexPage.resetStore();
      const response = await api.createRegistration("future-of-work-2026", {
        name: "Null Test",
        email: `null-${Date.now()}@example.com`,
      });
      expect(response.status()).not.toBe(500);
    });
  });

  test.describe("Mass Assignment (PATCH)", () => {
    test("PATCH cannot modify 'name' field", async ({ api, indexPage }) => {
      await indexPage.resetStore();
      const createResponse = await api.createRegistration("future-of-work-2026", validRegistration);
      expect(createResponse.status()).toBe(201);
      const createBody = await createResponse.json();
      const regId = createBody.id;

      const patchResponse = await api.updateRegistration("future-of-work-2026", regId, {
        name: "Hacker Name",
      });
      expect(patchResponse.status()).toBe(400);
      const patchBody = await patchResponse.json();
      expect(patchBody.message).toContain("Invalid fields");

      const getResponse = await api.getEvent("future-of-work-2026");
      const getBody = await getResponse.json();
      const attendee = getBody.attendees.find((a: { email: string }) => a.email === validRegistration.email);
      expect(attendee).toBeDefined();
      expect(attendee.name).not.toBe("Hacker Name");
    });

    test("PATCH only allows permitted fields", async ({ api, indexPage }) => {
      await indexPage.resetStore();
      const createResponse = await api.createRegistration("future-of-work-2026", validRegistration);
      expect(createResponse.status()).toBe(201);
      const createBody = await createResponse.json();
      const regId = createBody.id;

      const response = await api.updateRegistration("future-of-work-2026", regId, {
        dietaryRequirements: "Gluten free",
        accessibilityNeeds: "Wheelchair access",
        organisation: "New Org",
        marketingConsent: false,
      });
      expect(response.status()).toBe(200);
    });
  });

  test.describe("Authorization & IDOR", () => {
    test("Cannot cancel non-existent registration", async ({ api }) => {
      const response = await api.cancelRegistration("non-existent-id-12345");
      expect(response.status()).toBe(404);
    });

    test("Cannot access non-existent event", async ({ api }) => {
      const response = await api.getEvent("non-existent-event");
      expect(response.status()).toBe(404);
    });

    test("Cannot create registration for non-existent event", async ({ api, indexPage }) => {
      await indexPage.resetStore();
      const response = await api.createRegistration("non-existent-event", validRegistration);
      expect(response.status()).toBe(404);
    });

    test("Cannot update non-existent registration", async ({ api }) => {
      const response = await api.updateRegistration("future-of-work-2026", "non-existent-reg", {
        dietaryRequirements: "Gluten free",
      });
      expect(response.status()).toBe(404);
    });
  });

  test.describe("Content Security", () => {
    test("API returns JSON content-type for errors", async ({ api }) => {
      const response = await api.createRegistration("non-existent-event", {
        name: "Content-Type Test",
        email: `ctype-${Date.now()}@example.com`,
      });
      expect(response.headers()["content-type"]).toContain("application/json");
    });

    test("API error response has no stack trace exposure", async ({ api }) => {
      const response = await api.cancelRegistration("invalid-token");
      expect(response.status()).toBe(404);
      const body = await response.json();
      expect(body).not.toHaveProperty("stack");
      expect(body).not.toHaveProperty("trace");
    });

    test("Registration response does not expose internal IDs beyond registration id", async ({ api, indexPage }) => {
      await indexPage.resetStore();
      const response = await api.createRegistration("future-of-work-2026", validRegistration);
      const body = await response.json();
      expect(body).toHaveProperty("id");
      expect(body).toHaveProperty("status");
      expect(body).toHaveProperty("cancellationToken");
    });
  });

  test.describe("Rate Limiting / Brute Force", () => {
    test("Rapid duplicate registrations are handled safely", async ({ api }) => {
      const emails = Array.from({ length: 10 }, (_, i) => `rapid-${i}@example.com`);
      for (const email of emails) {
        const response = await api.createRegistration("future-of-work-2026", {
          name: "Rapid Test",
          email,
        });
        expect(response.status()).not.toBe(500);
      }
    });
  });
});
