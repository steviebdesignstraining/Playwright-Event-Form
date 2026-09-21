# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: browser.spec.ts >> Event Registration >> Register a guest with all valid details
- Location: e2e/tests/browser.spec.ts:22:3

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.fill: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('textbox', { name: 'Name' })

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - banner [ref=e2]:
    - link "Future Forum" [ref=e3] [cursor=pointer]:
      - /url: /
    - navigation "Primary navigation" [ref=e4]:
      - link "Event" [ref=e5] [cursor=pointer]:
        - /url: /
      - link "Test inbox" [ref=e6] [cursor=pointer]:
        - /url: /inbox
      - link "API docs" [ref=e7] [cursor=pointer]:
        - /url: /api-docs
  - main [ref=e8]:
    - generic [ref=e9]:
      - article [ref=e10]:
        - paragraph [ref=e11]: Free one-day forum
        - heading "The Human Future of Work" [level=1] [ref=e12]
        - paragraph [ref=e13]: A practical one-day forum for people designing humane digital services.
        - generic [ref=e14]:
          - generic [ref=e15]:
            - term [ref=e16]: Date
            - definition [ref=e17]: Tuesday, 20 October 2026 at 09:30
          - generic [ref=e18]:
            - term [ref=e19]: Venue
            - definition [ref=e20]: The Foundry, Leeds
        - region [ref=e21]:
          - heading "Register as a guest" [level=2] [ref=e22]
          - paragraph [ref=e23]: Fields marked * are required.
          - generic [ref=e24]:
            - generic [ref=e25]:
              - generic [ref=e26]: Name *
              - textbox [ref=e27]
            - generic [ref=e28]:
              - generic [ref=e29]: Email address *
              - textbox [ref=e30]
            - generic [ref=e31]:
              - generic [ref=e32]: Organisation
              - textbox [ref=e33]
            - generic [ref=e34]:
              - generic [ref=e35]: Dietary requirements
              - textbox [ref=e36]
            - generic [ref=e37]:
              - generic [ref=e38]: Accessibility needs
              - textbox [ref=e39]
            - generic [ref=e40]:
              - checkbox [ref=e41]
              - generic [ref=e42]: Send me news about future events
            - button "Register" [ref=e43] [cursor=pointer]
      - complementary [ref=e44]:
        - paragraph [ref=e45]: "0"
        - paragraph [ref=e46]: places remaining
        - paragraph [ref=e47]: 2 currently waiting
```

# Test source

```ts
  99  |     return L(this.page, locators.registration.heading());
  100 |   }
  101 | 
  102 |   get registrationForm() {
  103 |     return L(this.page, locators.registration.form());
  104 |   }
  105 | 
  106 |   get registrationResult() {
  107 |     return L(this.page, locators.registration.result());
  108 |   }
  109 | 
  110 |   get registrationErrorSummary() {
  111 |     return L(this.page, locators.registration.errorSummary());
  112 |   }
  113 | 
  114 |   get registrationFields() {
  115 |     return L(this.page, locators.registration.field());
  116 |   }
  117 | 
  118 |   get registrationFieldLabels() {
  119 |     return L(this.page, locators.registration.fieldLabel());
  120 |   }
  121 | 
  122 |   get registrationFieldErrors() {
  123 |     return L(this.page, locators.registration.fieldError());
  124 |   }
  125 | 
  126 |   get nameFieldError() {
  127 |     return L(this.page, locators.registration.nameFieldError());
  128 |   }
  129 | 
  130 |   get emailFieldError() {
  131 |     return L(this.page, locators.registration.emailFieldError());
  132 |   }
  133 | 
  134 |   get consentRow() {
  135 |     return L(this.page, locators.registration.consentRow());
  136 |   }
  137 | 
  138 |   get nameField() {
  139 |     return L(this.page, locators.registration.nameField());
  140 |   }
  141 | 
  142 |   get emailField() {
  143 |     return L(this.page, locators.registration.emailField());
  144 |   }
  145 | 
  146 |   get organisationField() {
  147 |     return L(this.page, locators.registration.organisationField());
  148 |   }
  149 | 
  150 |   get dietaryRequirementsField() {
  151 |     return L(this.page, locators.registration.dietaryRequirementsField());
  152 |   }
  153 | 
  154 |   get accessibilityNeedsField() {
  155 |     return L(this.page, locators.registration.accessibilityNeedsField());
  156 |   }
  157 | 
  158 |   get marketingConsentCheckbox() {
  159 |     return L(this.page, locators.registration.marketingConsentCheckbox());
  160 |   }
  161 | 
  162 |   get marketingConsentField() {
  163 |     return L(this.page, locators.registration.marketingConsentField());
  164 |   }
  165 | 
  166 |   get submitButton() {
  167 |     return L(this.page, locators.registration.submitButton());
  168 |   }
  169 | 
  170 |   get errorMessage() {
  171 |     return L(this.page, locators.registration.errorMessage());
  172 |   }
  173 | 
  174 |   get openTestInboxLink() {
  175 |     return L(this.page, locators.registration.openTestInboxLink());
  176 |   }
  177 | 
  178 |   get testInboxButton() {
  179 |     return L(this.page, locators.registration.testInboxButton());
  180 |   }
  181 | 
  182 |   get cancelLink() {
  183 |     return L(this.page, locators.registration.cancelLink());
  184 |   }
  185 | 
  186 |   async openTestInbox() {
  187 |     await this.openTestInboxLink.click();
  188 |     await expect(this.inboxPage).toBeVisible();
  189 |   }
  190 | 
  191 |   async registerGuest(data: {
  192 |     name: string;
  193 |     email: string;
  194 |     organisation?: string;
  195 |     dietaryRequirements?: string;
  196 |     accessibilityNeeds?: string;
  197 |     marketingConsent?: boolean;
  198 |   }) {
> 199 |     await this.nameField.fill(data.name);
      |                          ^ Error: locator.fill: Test timeout of 30000ms exceeded.
  200 |     await this.emailField.fill(data.email);
  201 |     if (data.organisation) {
  202 |       await this.organisationField.fill(data.organisation);
  203 |     }
  204 |     if (data.dietaryRequirements) {
  205 |       await this.dietaryRequirementsField.fill(data.dietaryRequirements);
  206 |     }
  207 |     if (data.accessibilityNeeds) {
  208 |       await this.accessibilityNeedsField.fill(data.accessibilityNeeds);
  209 |     }
  210 |     if (data.marketingConsent) {
  211 |       await this.marketingConsentCheckbox.check();
  212 |     }
  213 |     await this.submitButton.click();
  214 |     await expect(this.registrationResult).not.toBeEmpty();
  215 |   }
  216 | 
  217 |   async isRegistrationConfirmed() {
  218 |     await expect(this.registrationResult).toContainText('You are registered');
  219 |   }
  220 | 
  221 |   async isOnWaitingList() {
  222 |     await expect(this.registrationResult).toContainText('You are on the waiting list');
  223 |   }
  224 | 
  225 |   async isRegistrationSuccessful() {
  226 |     await expect(this.registrationResult).toContainText('Thank you');
  227 |   }
  228 | 
  229 |   // Inbox page
  230 |   get inboxPage() {
  231 |     return L(this.page, locators.inbox.page());
  232 |   }
  233 | 
  234 |   get inboxHeading() {
  235 |     return L(this.page, locators.inbox.heading());
  236 |   }
  237 | 
  238 |   get inboxEyebrow() {
  239 |     return L(this.page, locators.inbox.eyebrow());
  240 |   }
  241 | 
  242 |   get inboxDescription() {
  243 |     return L(this.page, locators.inbox.description());
  244 |   }
  245 | 
  246 |   get inboxFilterIndicator() {
  247 |     return L(this.page, locators.inbox.filterIndicator());
  248 |   }
  249 | 
  250 |   get inboxShowAllLink() {
  251 |     return L(this.page, locators.inbox.showAllLink());
  252 |   }
  253 | 
  254 |   get showAllButton() {
  255 |     return L(this.page, locators.inbox.showAllLink());
  256 |   }
  257 | 
  258 |   get cancelRegistrationButton() {
  259 |     return this.messageCards.first().getByRole('link', { name: /cancel/i });
  260 |   }
  261 | 
  262 |   get messageList() {
  263 |     return L(this.page, locators.inbox.messageList());
  264 |   }
  265 | 
  266 |   get messageCards() {
  267 |     return L(this.page, locators.inbox.messageCard());
  268 |   }
  269 | 
  270 |   // Cancellation page
  271 |   get cancelPage() {
  272 |     return L(this.page, locators.cancellation.page());
  273 |   }
  274 | 
  275 |   get confirmCancelButton() {
  276 |     return L(this.page, locators.cancellation.confirmButton());
  277 |   }
  278 | 
  279 |   get cancelResult() {
  280 |     return L(this.page, locators.cancellation.result());
  281 |   }
  282 | 
  283 |   // Shared
  284 |   get loadingPanel() {
  285 |     return L(this.page, locators.shared.loadingPanel());
  286 |   }
  287 | 
  288 |   get errorPage() {
  289 |     return L(this.page, locators.shared.errorPage());
  290 |   }
  291 | }
```