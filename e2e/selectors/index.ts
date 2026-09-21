// Playwright locators using role-based and semantic selectors
// Following Playwright best practices: https://playwright.dev/docs/locators

import type { Page, Locator } from '@playwright/test';

type Selector =
  | { type: 'role'; role: string; name?: string | RegExp; level?: number; exact?: boolean }
  | { type: 'id'; id: string }
  | { type: 'testId'; testId: string }
  | { type: 'className'; className: string }
  | { type: 'attribute'; attribute: Record<string, string> }
  | { type: 'text'; text: string };

const role = (role: string, options?: { name?: string | RegExp; level?: number; exact?: boolean }): Selector => ({
  type: 'role',
  role,
  ...options,
});
const byId = (id: string): Selector => ({ type: 'id', id });
const byTestId = (testId: string): Selector => ({ type: 'testId', testId });
const byClass = (className: string): Selector => ({ type: 'className', className });
const byAttr = (attribute: Record<string, string>): Selector => ({ type: 'attribute', attribute });
const byText = (text: string): Selector => ({ type: 'text', text });

export const locators = {
  // Header / Navigation
  header: {
    siteHeader: () => role('banner'),
    brand: () => role('link', { name: 'Future Forum' }),
    nav: () => role('navigation', { name: 'Primary navigation' }),
    eventLink: () => role('link', { name: 'Event' }),
    inboxLink: () => role('link', { name: 'Test inbox' }),
    apiDocsLink: () => role('link', { name: 'API docs' }),
  },

  // Main content
  mainContent: () => role('main'),

  // Event page
  event: {
    heading: () => role('heading', { level: 1 }),
    eyebrow: () => byText('Free one-day forum'),
    lede: () => role('paragraph'),
    details: () => role('definitionlist'),
    card: () => byClass('event-card'),
    layout: () => byClass('event-layout'),
    availability: {
      card: () => byClass('availability-card'),
      number: () => byClass('availability-number'),
      muted: () => byClass('muted'),
    },
  },

  // Registration form
  registration: {
    heading: () => role('heading', { level: 2, name: 'Register as a guest' }),
    form: () => role('form'),
    result: () => byId('registration-result'),
    errorSummary: () => byId('form-errors'),
    field: () => byClass('field'),
    fieldLabel: () => byClass('field-label'),
    fieldError: () => byClass('field-error'),
    nameFieldError: () => byAttr({ 'data-error-for': 'name' }),
    emailFieldError: () => byAttr({ 'data-error-for': 'email' }),
    nameField: () => byAttr({ name: 'name' }),
    emailField: () => byAttr({ name: 'email', type: 'email' }),
    organisationField: () => byAttr({ name: 'organisation' }),
    dietaryRequirementsField: () => byAttr({ name: 'dietaryRequirements' }),
    accessibilityNeedsField: () => byAttr({ name: 'accessibilityNeeds' }),
    marketingConsentCheckbox: () => byAttr({ name: 'marketingConsent', type: 'checkbox' }),
    marketingConsentField: () => byAttr({ name: 'marketingConsent', type: 'checkbox' }),
    consentRow: () => byClass('consent-row'),
    submitButton: () => role('button', { name: 'Register' }),
    errorMessage: () => byClass('error-message'),
    openTestInboxLink: () => role('link', { name: 'Open the test inbox' }),
    testInboxButton: () => role('link', { name: 'Test inbox' }),
    cancelLink: () => role('link', { name: /cancel/i }),
  },

  // Inbox page
  inbox: {
    page: () => byClass('inbox-page'),
    messageList: () => byClass('message-list'),
    messageCard: () => byClass('message-card'),
    heading: () => role('heading', { level: 1, name: 'Test inbox' }),
    eyebrow: () => byText('Local delivery substitute'),
    description: () => role('paragraph'),
    filterIndicator: () => role('paragraph'),
    showAllLink: () => role('link', { name: 'Show all' }),
    cancelLink: () => role('link', { name: /cancel/i }),
  },

  // Cancellation page
  cancellation: {
    page: () => byClass('cancel-page'),
    heading: () => role('heading', { level: 1, name: 'Cancel your registration' }),
    confirmButton: () => role('button', { name: 'Confirm cancellation' }),
    result: () => byId('cancel-result'),
  },

  // Shared
  shared: {
    loadingPanel: () => byClass('loading-panel'),
    errorPage: () => byClass('error-page'),
    primaryButton: () => role('button', { name: /register/i }),
    dangerButton: () => role('button', { name: /cancel/i }),
  },
} as const;

// Helper to build Playwright locator from selector object
export function toLocator(page: Page, selector: Selector): Locator {
  switch (selector.type) {
    case 'role':
      return page.getByRole(selector.role as any, selector);
    case 'id':
      return page.locator(`#${selector.id}`);
    case 'testId':
      return page.getByTestId(selector.testId);
    case 'className':
      return page.locator(`.${selector.className}`);
    case 'attribute':
      return page.locator(
        Object.entries(selector.attribute)
          .map(([k, v]) => `[${k}="${v}"]`)
          .join('')
      );
    case 'text':
      return page.getByText(selector.text);
  }
}

export type Locators = typeof locators;