import { expect, test } from "../fixtures/test-fixtures.js";
import {
  EMPTY_TOKEN,
  EVENT_ID,
  expectedConfirmedRegistration,
  INVALID_EVENT_ID,
  INVALID_TOKEN,
  invalidRegistrationBadEmail,
  invalidRegistrationEmptyEmail,
  invalidRegistrationEmptyName,
  invalidFieldsErrorMessage,
  invalidUpdatePayload,
  registrationPayload,
  registrationPatchPayload,
  validRegistration,
  waitingListRegistration,
  statusConfirmed,
  statusWaiting,
  statusCancelled,
  duplicateRegistrationErrorMessage,
  eventNotFoundMessage,
  cancellationNotFoundMessage,
  registrationNotFoundMessage,
  partialUpdatePayload,
  emailPrefixes,
  validRegistrationStatuses,
} from "../test-data/apiTestdata.data.ts";

test.describe.serial("API Regression Tests", () => {
  let createdRegistrationId: string;
  let createdWaitingId: string;
  let cancellationToken: string;

  test.beforeEach(async ({ resetStore }) => {
    await resetStore();
    createdRegistrationId = '';
    createdWaitingId = '';
    cancellationToken = '';
  });

  test.describe("Create Registration", () => {
    test("Create registration with valid data", async ({ api }) => {
      const response = await api.createRegistration(EVENT_ID, validRegistration);
      expect(response.status()).toBe(201);
      const body = await response.json();
      expect(body).toHaveProperty("id");
      expect(body.name).toBe(validRegistration.name);
      expect(body.status).toBe(statusConfirmed);
      createdRegistrationId = body.id;
    });

    test("Create registration when event is full", async ({ api }) => {
      const capacityResponse = await api.getEvent(EVENT_ID);
      const capacityBody = await capacityResponse.json();
      const capacity = capacityBody.capacity;

      const confirmedBefore = capacityBody.confirmed;
      for (let i = confirmedBefore; i < capacity; i++) {
        const email = `${emailPrefixes.capacity}-${i}-${Date.now()}@example.com`;
        const regResponse = await api.createRegistration(EVENT_ID, { name: `${emailPrefixes.genericUser} ${i}`, email });
        expect(regResponse.status()).toBe(201);
        const regBody = await regResponse.json();
        expect(regBody.status).toBe(statusConfirmed);
      }

      const waitingResponse = await api.createRegistration(EVENT_ID, waitingListRegistration);
      expect(waitingResponse.status()).toBe(201);
      const waitingBody = await waitingResponse.json();
      expect(waitingBody.status).toBe("waiting");
      createdWaitingId = waitingBody.id;
    });

    test("Create duplicate registration", async ({ api }) => {
      const firstResponse = await api.createRegistration(EVENT_ID, validRegistration);
      expect(firstResponse.status()).toBe(201);

      const duplicateResponse = await api.createRegistration(EVENT_ID, validRegistration);
      expect(duplicateResponse.status()).toBe(409);
      const body = await duplicateResponse.json();
      expect(body).toHaveProperty("message");
      expect(body.message).toContain(duplicateRegistrationErrorMessage);
    });

    test("Create registration without email", async ({ api }) => {
      const response = await api.createRegistration(EVENT_ID, invalidRegistrationEmptyEmail);
      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body).toHaveProperty("message");
    });

    test("Create registration without name", async ({ api }) => {
      const response = await api.createRegistration(EVENT_ID, invalidRegistrationEmptyName);
      expect(response.status()).toBe(201);
      const body = await response.json();
      expect(body).toHaveProperty("id");
    });

    test("Create registration with invalid email", async ({ api }) => {
      const response = await api.createRegistration(EVENT_ID, invalidRegistrationBadEmail);
      expect(response.status()).toBe(201);
      const body = await response.json();
      expect(body).toHaveProperty("id");
    });

    test("Create registration for invalid event", async ({ api }) => {
      const response = await api.createRegistration(INVALID_EVENT_ID, validRegistration);
      expect(response.status()).toBe(404);
      const body = await response.json();
      expect(body).toHaveProperty("message");
      expect(body.message).toContain(eventNotFoundMessage);
    });
  });

  test.describe("Retrieve Event", () => {
    test("Retrieve valid event", async ({ api }) => {
      const response = await api.getEvent(EVENT_ID);
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body).toHaveProperty("id");
      expect(body).toHaveProperty("title");
      expect(body).toHaveProperty("capacity");
      expect(body).toHaveProperty("confirmed");
      expect(body).toHaveProperty("placesRemaining");
    });

    test("Retrieve invalid event", async ({ api }) => {
      const response = await api.getEvent(INVALID_EVENT_ID);
      expect(response.status()).toBe(404);
      const body = await response.json();
      expect(body).toHaveProperty("message");
      expect(body.message).toContain(eventNotFoundMessage);
    });

    test("Verify event availability", async ({ api }) => {
      const beforeResponse = await api.getEvent(EVENT_ID);
      const beforeBody = await beforeResponse.json();

      const regResponse = await api.createRegistration(EVENT_ID, validRegistration);
      const regBody = await regResponse.json();
      expect(validRegistrationStatuses).toContain(regBody.status);

      const afterResponse = await api.getEvent(EVENT_ID);
      const afterBody = await afterResponse.json();

      expect(afterBody.attendees).toBeDefined();
      const attendee = afterBody.attendees.find((a: { email: string }) => a.email === validRegistration.email);
      expect(attendee).toBeDefined();
    });

    test("Verify waiting-list count", async ({ api }) => {
      const capacityResponse = await api.getEvent(EVENT_ID);
      const capacityBody = await capacityResponse.json();

      const confirmedBefore = capacityBody.confirmed;
      for (let i = confirmedBefore; i < capacityBody.capacity; i++) {
        const email = `${emailPrefixes.waitlistCount}-${i}-${Date.now()}@example.com`;
        const regResponse = await api.createRegistration(EVENT_ID, { name: `${emailPrefixes.genericUser} ${i}`, email });
        expect(regResponse.status()).toBe(201);
      }

      const waitingResponse = await api.createRegistration(EVENT_ID, waitingListRegistration);
      expect(waitingResponse.status()).toBe(201);

      const response = await api.getEvent(EVENT_ID);
      const body = await response.json();
      expect(body.waitListCount).toBeGreaterThanOrEqual(1);
    });
  });

  test.describe("Cancellation", () => {
    test("Cancel confirmed registration", async ({ api }) => {
      const regResponse = await api.createRegistration(EVENT_ID, validRegistration);
      expect(regResponse.status()).toBe(201);
      const regBody = await regResponse.json();
      const token = regBody.cancellationToken;

      const cancelResponse = await api.cancelRegistration(token);
      expect(cancelResponse.status()).toBe(200);
      const cancelBody = await cancelResponse.json();
      expect(cancelBody).toHaveProperty("cancelled");
      expect(cancelBody.cancelled.status).toBe(statusCancelled);
      cancellationToken = token;
    });

    test("Promote waiting guest after cancellation", async ({ api }) => {
      const capacityResponse = await api.getEvent(EVENT_ID);
      const capacityBody = await capacityResponse.json();

      const confirmedBefore = capacityBody.confirmed;
      for (let i = confirmedBefore; i < capacityBody.capacity; i++) {
        const email = `${emailPrefixes.promote}-${i}-${Date.now()}@example.com`;
        const regResponse = await api.createRegistration(EVENT_ID, { name: `${emailPrefixes.genericUser} ${i}`, email });
        expect(regResponse.status()).toBe(201);
      }

      const waitingResponse = await api.createRegistration(EVENT_ID, waitingListRegistration);
      expect(waitingResponse.status()).toBe(201);
      const waitingBody = await waitingResponse.json();
      const waitingId = waitingBody.id;

      const confirmResponse = await api.createRegistration(EVENT_ID, {
        name: `${emailPrefixes.genericUser} To Cancel`,
        email: `${emailPrefixes.toCancel}-${Date.now()}@example.com`,
      });
      expect(confirmResponse.status()).toBe(201);
      const confirmBody = await confirmResponse.json();
      const cancelToken = confirmBody.cancellationToken;

      const cancelResponse = await api.cancelRegistration(cancelToken);
      expect(cancelResponse.status()).toBe(200);
      const cancelBody = await cancelResponse.json();
      expect(cancelBody.cancelled.status).toBe(statusCancelled);

      expect(cancelBody.promoted).toBeDefined();
      expect(cancelBody.promoted!.status).toBe(statusConfirmed);
      cancellationToken = cancelToken;
    });

    test("Cancel waiting-list registration", async ({ api }) => {
      const capacityResponse = await api.getEvent(EVENT_ID);
      const capacityBody = await capacityResponse.json();

      const confirmedBefore = capacityBody.confirmed;
      for (let i = confirmedBefore; i < capacityBody.capacity; i++) {
        const email = `${emailPrefixes.cancelWaiting}-${i}-${Date.now()}@example.com`;
        await api.createRegistration(EVENT_ID, { name: `${emailPrefixes.genericUser} ${i}`, email });
      }

      const waitingResponse = await api.createRegistration(EVENT_ID, waitingListRegistration);
      expect(waitingResponse.status()).toBe(201);
      const waitingBody = await waitingResponse.json();
      const token = waitingBody.cancellationToken;

      const cancelResponse = await api.cancelRegistration(token);
      expect(cancelResponse.status()).toBe(200);
      const cancelBody = await cancelResponse.json();
      expect(cancelBody.cancelled.status).toBe(statusCancelled);

      const afterCancelResponse = await api.getEvent(EVENT_ID);
      const afterCancelBody = await afterCancelResponse.json();
      const originalWaitingCount = afterCancelBody.waitListCount;
      expect(originalWaitingCount).toBeGreaterThanOrEqual(0);
      cancellationToken = token;
    });

    test("Cancel using invalid token", async ({ api }) => {
      const response = await api.cancelRegistration(INVALID_TOKEN);
      expect(response.status()).toBe(404);
      const body = await response.json();
      expect(body).toHaveProperty("message");
      expect(body.message).toContain("not found");
    });

    test("Cancel already cancelled registration", async ({ api }) => {
      const regResponse = await api.createRegistration(EVENT_ID, validRegistration);
      expect(regResponse.status()).toBe(201);
      const regBody = await regResponse.json();
      const token = regBody.cancellationToken;

      const firstCancel = await api.cancelRegistration(token);
      expect(firstCancel.status()).toBe(200);

      const secondCancel = await api.cancelRegistration(token);
      expect(secondCancel.status()).toBe(200);
      const body = await secondCancel.json();
      expect(body).toHaveProperty("cancelled");
      cancellationToken = token;
    });

    test("Cancel with empty token", async ({ api }) => {
      const response = await api.cancelRegistration(EMPTY_TOKEN);
      expect(response.status()).toBe(404);
    });
  });

  test.describe("Update Registration", () => {
    test("Update existing resource", async ({ api }) => {
      const regResponse = await api.createRegistration(EVENT_ID, validRegistration);
      expect(regResponse.status()).toBe(201);
      const regBody = await regResponse.json();
      const registrationId = regBody.id;

      const patchResponse = await api.updateRegistration(EVENT_ID, registrationId, registrationPatchPayload);
      expect(patchResponse.status()).toBe(200);
      const patchBody = await patchResponse.json();
      expect(patchBody.id).toBe(registrationId);
      expect(patchBody.dietaryRequirements).toBe(registrationPatchPayload.dietaryRequirements);
      expect(patchBody.accessibilityNeeds).toBe(registrationPatchPayload.accessibilityNeeds);
    });

    test("Update with valid partial data", async ({ api }) => {
      const regResponse = await api.createRegistration(EVENT_ID, validRegistration);
      expect(regResponse.status()).toBe(201);
      const regBody = await regResponse.json();
      const registrationId = regBody.id;

      const patchResponse = await api.updateRegistration(EVENT_ID, registrationId, partialUpdatePayload);
      expect(patchResponse.status()).toBe(200);
      const patchBody = await patchResponse.json();
      expect(patchBody.id).toBe(registrationId);
      expect(patchBody.organisation).toBe(partialUpdatePayload.organisation);
      expect(patchBody.dietaryRequirements).toBe(validRegistration.dietaryRequirements);
      expect(patchBody.accessibilityNeeds).toBe(validRegistration.accessibilityNeeds);
    });

    test("Update non-existent resource", async ({ api }) => {
      const response = await api.updateRegistration(EVENT_ID, 'reg-999', registrationPatchPayload);
      expect(response.status()).toBe(404);
      const body = await response.json();
      expect(body).toHaveProperty("message");
      expect(body.message).toContain(registrationNotFoundMessage);
    });

    test("Update with invalid data", async ({ api }) => {
      const regResponse = await api.createRegistration(EVENT_ID, validRegistration);
      expect(regResponse.status()).toBe(201);
      const regBody = await regResponse.json();
      const registrationId = regBody.id;

      const originalName = regBody.name;
      const patchResponse = await api.updateRegistration(EVENT_ID, registrationId, invalidUpdatePayload);
      expect(patchResponse.status()).toBe(400);
      const patchBody = await patchResponse.json();
      expect(patchBody).toHaveProperty("message");
      expect(patchBody.message).toContain(invalidFieldsErrorMessage);
    });
  });
});
