# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: api.spec.ts >> API Regression Tests >> Retrieve Event >> Verify event availability
- Location: e2e/tests/api.spec.ts:127:5

# Error details

```
Error: expect(received).toBeDefined()

Received: undefined
```

# Test source

```ts
  40  |       expect(body.name).toBe(validRegistration.name);
  41  |       expect(body.status).toBe(expectedConfirmedRegistration.status);
  42  |       createdRegistrationId = body.id;
  43  |     });
  44  | 
  45  |     test("Create registration when event is full", async () => {
  46  |       const capacityResponse = await api.getEvent(EVENT_ID);
  47  |       const capacityBody = await capacityResponse.json();
  48  |       const capacity = capacityBody.capacity;
  49  | 
  50  |       const confirmedBefore = capacityBody.confirmed;
  51  |       for (let i = confirmedBefore; i < capacity; i++) {
  52  |         const email = `capacity-${i}-${Date.now()}@example.com`;
  53  |         const regResponse = await api.createRegistration(EVENT_ID, { name: `User ${i}`, email });
  54  |         expect(regResponse.status()).toBe(201);
  55  |         const regBody = await regResponse.json();
  56  |         expect(regBody.status).toBe("confirmed");
  57  |       }
  58  | 
  59  |       const waitingResponse = await api.createRegistration(EVENT_ID, waitingListRegistration);
  60  |       expect(waitingResponse.status()).toBe(201);
  61  |       const waitingBody = await waitingResponse.json();
  62  |       expect(waitingBody.status).toBe("waiting");
  63  |       createdWaitingId = waitingBody.id;
  64  |     });
  65  | 
  66  |     test("Create duplicate registration", async () => {
  67  |       const firstResponse = await api.createRegistration(EVENT_ID, validRegistration);
  68  |       expect(firstResponse.status()).toBe(201);
  69  | 
  70  |       const duplicateResponse = await api.createRegistration(EVENT_ID, validRegistration);
  71  |       expect(duplicateResponse.status()).toBe(409);
  72  |       const body = await duplicateResponse.json();
  73  |       expect(body).toHaveProperty("message");
  74  |       expect(body.message).toContain("already registered");
  75  |     });
  76  | 
  77  |     test("Create registration without email", async () => {
  78  |       const response = await api.createRegistration(EVENT_ID, invalidRegistrationEmptyEmail);
  79  |       expect(response.status()).toBe(400);
  80  |       const body = await response.json();
  81  |       expect(body).toHaveProperty("message");
  82  |     });
  83  | 
  84  |     test("Create registration without name", async () => {
  85  |       const response = await api.createRegistration(EVENT_ID, invalidRegistrationEmptyName);
  86  |       expect(response.status()).toBe(201);
  87  |       const body = await response.json();
  88  |       expect(body).toHaveProperty("id");
  89  |     });
  90  | 
  91  |     test("Create registration with invalid email", async () => {
  92  |       const response = await api.createRegistration(EVENT_ID, invalidRegistrationBadEmail);
  93  |       expect(response.status()).toBe(201);
  94  |       const body = await response.json();
  95  |       expect(body).toHaveProperty("id");
  96  |     });
  97  | 
  98  |     test("Create registration for invalid event", async () => {
  99  |       const response = await api.createRegistration(INVALID_EVENT_ID, validRegistration);
  100 |       expect(response.status()).toBe(404);
  101 |       const body = await response.json();
  102 |       expect(body).toHaveProperty("message");
  103 |       expect(body.message).toContain("Event not found");
  104 |     });
  105 |   });
  106 | 
  107 |   test.describe("Retrieve Event", () => {
  108 |     test("Retrieve valid event", async () => {
  109 |       const response = await api.getEvent(EVENT_ID);
  110 |       expect(response.status()).toBe(200);
  111 |       const body = await response.json();
  112 |       expect(body).toHaveProperty("id");
  113 |       expect(body).toHaveProperty("title");
  114 |       expect(body).toHaveProperty("capacity");
  115 |       expect(body).toHaveProperty("confirmed");
  116 |       expect(body).toHaveProperty("placesRemaining");
  117 |     });
  118 | 
  119 |     test("Retrieve invalid event", async () => {
  120 |       const response = await api.getEvent(INVALID_EVENT_ID);
  121 |       expect(response.status()).toBe(404);
  122 |       const body = await response.json();
  123 |       expect(body).toHaveProperty("message");
  124 |       expect(body.message).toContain("Event not found");
  125 |     });
  126 | 
  127 |     test("Verify event availability", async () => {
  128 |       const beforeResponse = await api.getEvent(EVENT_ID);
  129 |       const beforeBody = await beforeResponse.json();
  130 | 
  131 |       const regResponse = await api.createRegistration(EVENT_ID, validRegistration);
  132 |       const regBody = await regResponse.json();
  133 |       expect(["confirmed", "waiting"]).toContain(regBody.status);
  134 | 
  135 |       const afterResponse = await api.getEvent(EVENT_ID);
  136 |       const afterBody = await afterResponse.json();
  137 | 
  138 |       expect(afterBody.attendees).toBeDefined();
  139 |       const attendee = afterBody.attendees.find((a: { email: string }) => a.email === validRegistration.email);
> 140 |       expect(attendee).toBeDefined();
      |                        ^ Error: expect(received).toBeDefined()
  141 |     });
  142 | 
  143 |     test("Verify waiting-list count", async () => {
  144 |       const capacityResponse = await api.getEvent(EVENT_ID);
  145 |       const capacityBody = await capacityResponse.json();
  146 | 
  147 |       const confirmedBefore = capacityBody.confirmed;
  148 |       for (let i = confirmedBefore; i < capacityBody.capacity; i++) {
  149 |         const email = `waitlist-count-${i}-${Date.now()}@example.com`;
  150 |         const regResponse = await api.createRegistration(EVENT_ID, { name: `User ${i}`, email });
  151 |         expect(regResponse.status()).toBe(201);
  152 |       }
  153 | 
  154 |       const waitingResponse = await api.createRegistration(EVENT_ID, waitingListRegistration);
  155 |       expect(waitingResponse.status()).toBe(201);
  156 | 
  157 |       const response = await api.getEvent(EVENT_ID);
  158 |       const body = await response.json();
  159 |       expect(body.waitListCount).toBeGreaterThanOrEqual(1);
  160 |     });
  161 |   });
  162 | 
  163 |   test.describe("Cancellation", () => {
  164 |     test("Cancel confirmed registration", async () => {
  165 |       const regResponse = await api.createRegistration(EVENT_ID, validRegistration);
  166 |       expect(regResponse.status()).toBe(201);
  167 |       const regBody = await regResponse.json();
  168 |       const token = regBody.cancellationToken;
  169 | 
  170 |       const cancelResponse = await api.cancelRegistration(token);
  171 |       expect(cancelResponse.status()).toBe(200);
  172 |       const cancelBody = await cancelResponse.json();
  173 |       expect(cancelBody).toHaveProperty("cancelled");
  174 |       expect(cancelBody.cancelled.status).toBe("cancelled");
  175 |       cancellationToken = token;
  176 |     });
  177 | 
  178 |     test("Promote waiting guest after cancellation", async () => {
  179 |       const capacityResponse = await api.getEvent(EVENT_ID);
  180 |       const capacityBody = await capacityResponse.json();
  181 | 
  182 |       const confirmedBefore = capacityBody.confirmed;
  183 |       for (let i = confirmedBefore; i < capacityBody.capacity; i++) {
  184 |         const email = `promote-${i}-${Date.now()}@example.com`;
  185 |         const regResponse = await api.createRegistration(EVENT_ID, { name: `User ${i}`, email });
  186 |         expect(regResponse.status()).toBe(201);
  187 |       }
  188 | 
  189 |       const waitingResponse = await api.createRegistration(EVENT_ID, waitingListRegistration);
  190 |       expect(waitingResponse.status()).toBe(201);
  191 |       const waitingBody = await waitingResponse.json();
  192 |       const waitingId = waitingBody.id;
  193 | 
  194 |       const confirmResponse = await api.createRegistration(EVENT_ID, {
  195 |         name: "To Cancel",
  196 |         email: `to-cancel-${Date.now()}@example.com`,
  197 |       });
  198 |       expect(confirmResponse.status()).toBe(201);
  199 |       const confirmBody = await confirmResponse.json();
  200 |       const cancelToken = confirmBody.cancellationToken;
  201 | 
  202 |       const cancelResponse = await api.cancelRegistration(cancelToken);
  203 |       expect(cancelResponse.status()).toBe(200);
  204 |       const cancelBody = await cancelResponse.json();
  205 |       expect(cancelBody.cancelled.status).toBe("cancelled");
  206 | 
  207 |       expect(cancelBody.promoted).toBeDefined();
  208 |       expect(cancelBody.promoted!.status).toBe("confirmed");
  209 |       cancellationToken = cancelToken;
  210 |     });
  211 | 
  212 |     test("Cancel waiting-list registration", async () => {
  213 |       const capacityResponse = await api.getEvent(EVENT_ID);
  214 |       const capacityBody = await capacityResponse.json();
  215 | 
  216 |       const confirmedBefore = capacityBody.confirmed;
  217 |       for (let i = confirmedBefore; i < capacityBody.capacity; i++) {
  218 |         const email = `cancel-waiting-${i}-${Date.now()}@example.com`;
  219 |         await api.createRegistration(EVENT_ID, { name: `User ${i}`, email });
  220 |       }
  221 | 
  222 |       const waitingResponse = await api.createRegistration(EVENT_ID, waitingListRegistration);
  223 |       expect(waitingResponse.status()).toBe(201);
  224 |       const waitingBody = await waitingResponse.json();
  225 |       const token = waitingBody.cancellationToken;
  226 | 
  227 |       const cancelResponse = await api.cancelRegistration(token);
  228 |       expect(cancelResponse.status()).toBe(200);
  229 |       const cancelBody = await cancelResponse.json();
  230 |       expect(cancelBody.cancelled.status).toBe("cancelled");
  231 | 
  232 |       const afterCancelResponse = await api.getEvent(EVENT_ID);
  233 |       const afterCancelBody = await afterCancelResponse.json();
  234 |       const originalWaitingCount = afterCancelBody.waitListCount;
  235 |       expect(originalWaitingCount).toBeGreaterThanOrEqual(0);
  236 |       cancellationToken = token;
  237 |     });
  238 | 
  239 |     test("Cancel using invalid token", async () => {
  240 |       const response = await api.cancelRegistration(INVALID_TOKEN);
```