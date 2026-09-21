import { type Locator, type Page, expect } from '@playwright/test';
import { locators, toLocator } from '../selectors/index.ts';

function L(page: Page, selector: ReturnType<typeof locators.header.siteHeader>): Locator {
  return toLocator(page, selector);
}

export class IndexPage {
  readonly page: Page;
  readonly heading: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole('heading', { name: 'The Human Future of Work' });
  }

  async goto() {
    const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:3000';
    await this.page.goto(`${baseUrl}/`);
  }

  async resetStore() {
    const apiUrl = process.env.API_URL || 'http://127.0.0.1:3000/api';
    await this.page.request.post(`${apiUrl}/reset`);
  }

  async isHeadingVisible() {
    await expect(this.heading).toBeVisible();
  }

  // Header / Navigation
  get siteHeader() {
    return L(this.page, locators.header.siteHeader());
  }

  get brand() {
    return L(this.page, locators.header.brand());
  }

  get nav() {
    return L(this.page, locators.header.nav());
  }

  get eventLink() {
    return L(this.page, locators.header.eventLink());
  }

  get inboxLink() {
    return L(this.page, locators.header.inboxLink());
  }

  get apiDocsLink() {
    return L(this.page, locators.header.apiDocsLink());
  }

  get mainContent() {
    return L(this.page, locators.mainContent());
  }

  // Event page
  get eventHeading() {
    return L(this.page, locators.event.heading());
  }

  get eventEyebrow() {
    return L(this.page, locators.event.eyebrow());
  }

  get eventLede() {
    return L(this.page, locators.event.lede());
  }

  get eventDetails() {
    return L(this.page, locators.event.details());
  }

  get eventCard() {
    return L(this.page, locators.event.card());
  }

  get eventLayout() {
    return L(this.page, locators.event.layout());
  }

  get availabilityCard() {
    return L(this.page, locators.event.availability.card());
  }

  get availabilityNumber() {
    return L(this.page, locators.event.availability.number());
  }

  get availabilityMuted() {
    return L(this.page, locators.event.availability.muted());
  }

  // Registration form
  get registrationHeading() {
    return L(this.page, locators.registration.heading());
  }

  get registrationForm() {
    return L(this.page, locators.registration.form());
  }

  get registrationResult() {
    return L(this.page, locators.registration.result());
  }

  get registrationErrorSummary() {
    return L(this.page, locators.registration.errorSummary());
  }

  get registrationFields() {
    return L(this.page, locators.registration.field());
  }

  get registrationFieldLabels() {
    return L(this.page, locators.registration.fieldLabel());
  }

  get registrationFieldErrors() {
    return L(this.page, locators.registration.fieldError());
  }

  get nameFieldError() {
    return L(this.page, locators.registration.nameFieldError());
  }

  get emailFieldError() {
    return L(this.page, locators.registration.emailFieldError());
  }

  get consentRow() {
    return L(this.page, locators.registration.consentRow());
  }

  get nameField() {
    return L(this.page, locators.registration.nameField());
  }

  get emailField() {
    return L(this.page, locators.registration.emailField());
  }

  get organisationField() {
    return L(this.page, locators.registration.organisationField());
  }

  get dietaryRequirementsField() {
    return L(this.page, locators.registration.dietaryRequirementsField());
  }

  get accessibilityNeedsField() {
    return L(this.page, locators.registration.accessibilityNeedsField());
  }

  get marketingConsentCheckbox() {
    return L(this.page, locators.registration.marketingConsentCheckbox());
  }

  get marketingConsentField() {
    return L(this.page, locators.registration.marketingConsentField());
  }

  get submitButton() {
    return L(this.page, locators.registration.submitButton());
  }

  get errorMessage() {
    return L(this.page, locators.registration.errorMessage());
  }

  get openTestInboxLink() {
    return L(this.page, locators.registration.openTestInboxLink());
  }

  get testInboxButton() {
    return L(this.page, locators.registration.testInboxButton());
  }

  get cancelLink() {
    return L(this.page, locators.registration.cancelLink());
  }

  async openTestInbox() {
    await this.openTestInboxLink.click();
    await expect(this.inboxPage).toBeVisible();
  }

  async registerGuest(data: {
    name: string;
    email: string;
    organisation?: string;
    dietaryRequirements?: string;
    accessibilityNeeds?: string;
    marketingConsent?: boolean;
  }) {
    await this.nameField.fill(data.name);
    await this.emailField.fill(data.email);
    if (data.organisation) {
      await this.organisationField.fill(data.organisation);
    }
    if (data.dietaryRequirements) {
      await this.dietaryRequirementsField.fill(data.dietaryRequirements);
    }
    if (data.accessibilityNeeds) {
      await this.accessibilityNeedsField.fill(data.accessibilityNeeds);
    }
    if (data.marketingConsent) {
      await this.marketingConsentCheckbox.check();
    }
    await this.submitButton.click();
    await expect(this.registrationResult).not.toBeEmpty();
  }

  async isRegistrationConfirmed() {
    await expect(this.registrationResult).toContainText('You are registered');
  }

  async isOnWaitingList() {
    await expect(this.registrationResult).toContainText('You are on the waiting list');
  }

  async isRegistrationSuccessful() {
    await expect(this.registrationResult).toContainText('Thank you');
  }

  // Inbox page
  get inboxPage() {
    return L(this.page, locators.inbox.page());
  }

  get inboxHeading() {
    return L(this.page, locators.inbox.heading());
  }

  get inboxEyebrow() {
    return L(this.page, locators.inbox.eyebrow());
  }

  get inboxDescription() {
    return L(this.page, locators.inbox.description());
  }

  get inboxFilterIndicator() {
    return L(this.page, locators.inbox.filterIndicator());
  }

  get inboxShowAllLink() {
    return L(this.page, locators.inbox.showAllLink());
  }

  get showAllButton() {
    return L(this.page, locators.inbox.showAllLink());
  }

  get cancelRegistrationButton() {
    return this.messageCards.first().getByRole('link', { name: /cancel/i });
  }

  get messageList() {
    return L(this.page, locators.inbox.messageList());
  }

  get messageCards() {
    return L(this.page, locators.inbox.messageCard());
  }

  // Cancellation page
  get cancelPage() {
    return L(this.page, locators.cancellation.page());
  }

  get confirmCancelButton() {
    return L(this.page, locators.cancellation.confirmButton());
  }

  get cancelResult() {
    return L(this.page, locators.cancellation.result());
  }

  // Shared
  get loadingPanel() {
    return L(this.page, locators.shared.loadingPanel());
  }

  get errorPage() {
    return L(this.page, locators.shared.errorPage());
  }
}