import { expect, test } from "../fixtures/test-fixtures.js";
import { validRegistration } from "../test-data/apiTestdata.data.ts";

test.describe.serial("Usability CRUD Scenarios", () => {
  test.describe("Create (Registration)", () => {
    test("Guest can register with all valid details via UI", async ({ indexPage, resetStore }) => {
      await resetStore();
      await indexPage.registerGuest(validRegistration);
      await indexPage.isRegistrationSuccessful();
      await expect(indexPage.registrationResult).toContainText(validRegistration.name);
      await expect(indexPage.registrationResult).toContainText(validRegistration.email);
    });

    test("Guest can register without marketing consent", async ({ indexPage, resetStore }) => {
      await resetStore();
      await indexPage.registerGuest({
        name: "No Consent User",
        email: "no-consent@example.com",
        marketingConsent: false,
      });
      await indexPage.isRegistrationSuccessful();
    });

    test("Guest receives confirmation message after registration", async ({ indexPage, resetStore }) => {
      await resetStore();
      await indexPage.registerGuest(validRegistration);
      await indexPage.isRegistrationSuccessful();
      await indexPage.openTestInbox();
      await expect(indexPage.inboxHeading).toContainText("Test inbox");
      await expect(indexPage.messageCards).toHaveCount(1);
    });

    test("Duplicate registration shows error gracefully", async ({ api, indexPage }) => {
      await indexPage.resetStore();
      const first = await api.createRegistration("future-of-work-2026", validRegistration);
      expect(first.status()).toBe(201);
      const second = await api.createRegistration("future-of-work-2026", validRegistration);
      expect(second.status()).toBe(409);
      const body = await second.json();
      expect(body.message).toContain("already registered");
    });
  });

  test.describe("Read (View Data)", () => {
    test("Event page displays event details", async ({ indexPage, resetStore }) => {
      await resetStore();
      await indexPage.goto();
      await expect(indexPage.eventHeading).toBeVisible();
      await expect(indexPage.eventHeading).toContainText("The Human Future of Work");
      await expect(indexPage.eventCard).toBeVisible();
    });

    test("Availability card shows correct counts after registration", async ({ indexPage, resetStore }) => {
      await resetStore();
      await indexPage.registerGuest(validRegistration);
      await indexPage.goto();
      const availability = await indexPage.availabilityNumber.textContent();
      expect(parseInt(availability || "0")).toBeLessThanOrEqual(3);
    });

    test("Inbox displays registration confirmation message", async ({ indexPage, resetStore }) => {
      await resetStore();
      await indexPage.registerGuest(validRegistration);
      await indexPage.openTestInbox();
      await expect(indexPage.messageCards.first()).toContainText(validRegistration.email);
      await expect(indexPage.messageCards.first()).toContainText(validRegistration.name);
    });

    test("Inbox 'Show all' displays all messages", async ({ indexPage, resetStore }) => {
      await resetStore();
      await indexPage.registerGuest(validRegistration);
      await indexPage.openTestInbox();
      await expect(indexPage.inboxHeading).toContainText("Test inbox");
      await indexPage.showAllButton.click();
      await expect(indexPage.messageCards).toHaveCount(5);
    });

    test("API returns event details correctly", async ({ api }) => {
      const response = await api.getEvent("future-of-work-2026");
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body).toHaveProperty("id");
      expect(body).toHaveProperty("title");
      expect(body).toHaveProperty("capacity");
      expect(body).toHaveProperty("confirmed");
      expect(body).toHaveProperty("placesRemaining");
    });
  });

  test.describe("Update (Modify Registration)", () => {
    test("Registration details can be updated via API", async ({ api, indexPage }) => {
      await indexPage.resetStore();
      const response = await api.createRegistration("future-of-work-2026", validRegistration);
      expect(response.status()).toBe(201);
      const body = await response.json();
      const regId = body.id;

      const patchResponse = await api.updateRegistration("future-of-work-2026", regId, {
        dietaryRequirements: "Vegan",
        accessibilityNeeds: "None",
      });
      expect(patchResponse.status()).toBe(200);
      const patchBody = await patchResponse.json();
      expect(patchBody.dietaryRequirements).toBe("Vegan");
      expect(patchBody.accessibilityNeeds).toBe("None");
    });

    test("Registration update preserves unchanged fields", async ({ api, indexPage }) => {
      await indexPage.resetStore();
      const response = await api.createRegistration("future-of-work-2026", validRegistration);
      expect(response.status()).toBe(201);
      const body = await response.json();
      const regId = body.id;

      const originalName = body.name;
      const originalEmail = body.email;

      const patchResponse = await api.updateRegistration("future-of-work-2026", regId, {
        organisation: "Updated Org",
      });
      const patchBody = await patchResponse.json();
      expect(patchBody.name).toBe(originalName);
      expect(patchBody.email).toBe(originalEmail);
    });

    test("Registration update rejects invalid fields", async ({ api, indexPage }) => {
      await indexPage.resetStore();
      const response = await api.createRegistration("future-of-work-2026", validRegistration);
      expect(response.status()).toBe(201);
      const body = await response.json();
      const regId = body.id;

      const patchResponse = await api.updateRegistration("future-of-work-2026", regId, {
        name: "New Name",
      });
      expect(patchResponse.status()).toBe(400);
    });
  });

  test.describe("Delete (Cancellation)", () => {
    test("Guest can cancel registration via UI", async ({ indexPage, resetStore }) => {
      await resetStore();
      await indexPage.registerGuest(validRegistration);
      await indexPage.isRegistrationSuccessful();
      await indexPage.openTestInbox();

      await indexPage.cancelRegistrationButton.click();
      await expect(indexPage.confirmCancelButton).toBeVisible();
      await indexPage.confirmCancelButton.click();

      await expect(indexPage.cancelResult).toContainText("Registration cancelled");
    });

    test("Cancelled registration message remains visible in inbox", async ({ indexPage, resetStore }) => {
      await resetStore();
      await indexPage.registerGuest(validRegistration);
      await indexPage.isRegistrationSuccessful();
      await indexPage.openTestInbox();

      const firstCardText = await indexPage.messageCards.first().textContent();
      expect(firstCardText, "First message card should have text").not.toBeNull();
      expect(firstCardText!.includes(validRegistration.email)).toBe(true);

      await indexPage.cancelRegistrationButton.click();
      await indexPage.confirmCancelButton.click();

      await indexPage.testInboxButton.click();
      const filteredCards = indexPage.messageCards.filter({ hasText: validRegistration.email });
      await expect(filteredCards.first()).toContainText(validRegistration.email);
    });

    test("Cancellation via API works correctly", async ({ api, indexPage }) => {
      await indexPage.resetStore();
      const createResponse = await api.createRegistration("future-of-work-2026", validRegistration);
      expect(createResponse.status()).toBe(201);
      const createBody = await createResponse.json();
      const token = createBody.cancellationToken;

      const cancelResponse = await api.cancelRegistration(token);
      expect(cancelResponse.status()).toBe(200);
      const cancelBody = await cancelResponse.json();
      expect(cancelBody.cancelled.status).toBe("cancelled");
    });

    test("Cancelling non-existent token returns 404", async ({ api }) => {
      const response = await api.cancelRegistration("definitely-not-a-real-token");
      expect(response.status()).toBe(404);
    });
  });

  test.describe("Full CRUD Lifecycle", () => {
    test("Complete create → read → update → delete flow via API", async ({ api, indexPage }) => {
      await indexPage.resetStore();
      const uniqueEmail = `crud-lifecycle-${Date.now()}@example.com`;

      const create = await api.createRegistration("future-of-work-2026", {
        name: "CRUD Test",
        email: uniqueEmail,
        organisation: "Test Org",
        dietaryRequirements: "Vegetarian",
        accessibilityNeeds: "None",
        marketingConsent: true,
      });
      expect(create.status()).toBe(201);
      const createBody = await create.json();
      expect(createBody.email).toBe(uniqueEmail);
      expect(createBody.status).toBe("confirmed");
      const registrationId = createBody.id;

      const read = await api.getEvent("future-of-work-2026");
      expect(read.status()).toBe(200);
      const readBody = await read.json();
      const attendee = readBody.attendees.find((a: { email: string }) => a.email === uniqueEmail);
      expect(attendee).toBeDefined();
      expect(attendee.name).toBe("CRUD Test");

      const update = await api.updateRegistration("future-of-work-2026", registrationId, {
        dietaryRequirements: "Vegan",
        accessibilityNeeds: "Step-free access",
      });
      expect(update.status()).toBe(200);
      const updateBody = await update.json();
      expect(updateBody.dietaryRequirements).toBe("Vegan");
      expect(updateBody.accessibilityNeeds).toBe("Step-free access");

      const cancel = await api.cancelRegistration(createBody.cancellationToken);
      expect(cancel.status()).toBe(200);
      const cancelBody = await cancel.json();
      expect(cancelBody.cancelled.status).toBe("cancelled");
    });

    test("Full CRUD lifecycle via UI", async ({ indexPage, resetStore }) => {
      await resetStore();

      await indexPage.registerGuest({
        name: "UI CRUD Test",
        email: `ui-crud-${Date.now()}@example.com`,
      });
      await indexPage.isRegistrationSuccessful();

      await indexPage.openTestInbox();
      await expect(indexPage.messageCards).toHaveCount(1);
      await expect(indexPage.messageCards.first()).toContainText("UI CRUD Test");

      await indexPage.testInboxButton.click();
      await indexPage.cancelRegistrationButton.click();
      await expect(indexPage.confirmCancelButton).toBeVisible();
      await indexPage.confirmCancelButton.click();
      await expect(indexPage.cancelResult).toContainText("Registration cancelled");
    });
  });

  test.describe("Capacity & Waitlist CRUD", () => {
    test("Event reaches capacity and waitlist activates", async ({ api, indexPage }) => {
      await indexPage.resetStore();
      const capacityResponse = await api.getEvent("future-of-work-2026");
      const capacityBody = await capacityResponse.json();
      const capacity = capacityBody.capacity;
      const confirmedBefore = capacityBody.confirmed;
      const spotsRemaining = capacity - confirmedBefore;

      for (let i = 0; i < spotsRemaining; i++) {
        const email = `capacity-${i}@example.com`;
        const response = await api.createRegistration("future-of-work-2026", {
          name: `Capacity User ${i}`,
          email,
        });
        expect(response.status()).toBe(201);
        const body = await response.json();
        expect(body.status).toBe("confirmed");
      }

      const waitlistResponse = await api.createRegistration("future-of-work-2026", {
        name: "Waitlist User",
        email: "waitlist@example.com",
      });
      expect(waitlistResponse.status()).toBe(201);
      const waitlistBody = await waitlistResponse.json();
      expect(waitlistBody.status).toBe("waiting");
    });

    test("Cancellation promotes waiting list guest", async ({ api, indexPage }) => {
      await indexPage.resetStore();
      const capacityResponse = await api.getEvent("future-of-work-2026");
      const capacityBody = await capacityResponse.json();
      const confirmedBefore = capacityBody.confirmed;
      const spotsToFill = capacityBody.capacity - confirmedBefore;

      for (let i = 0; i < spotsToFill; i++) {
        await api.createRegistration("future-of-work-2026", {
          name: `Promote User ${i}`,
          email: `promote-${i}@example.com`,
        });
      }

      const waitlistResponse = await api.createRegistration("future-of-work-2026", {
        name: "To Be Promoted",
        email: "promoted@example.com",
      });
      const waitlistBody = await waitlistResponse.json();

      const extraResponse = await api.createRegistration("future-of-work-2026", {
        name: "To Cancel",
        email: "tocancel@example.com",
      });
      const extraBody = await extraResponse.json();

      const cancelResponse = await api.cancelRegistration(extraBody.cancellationToken);
      expect(cancelResponse.status()).toBe(200);
      const cancelBody = await cancelResponse.json();

      expect(cancelBody.promoted).toBeDefined();
      expect(cancelBody.promoted.status).toBe("confirmed");
      expect(cancelBody.promoted.name).toBe("To Be Promoted");
    });
  });
});
