export function randomEmail(prefix = 'user'): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${random}@example.com`;
}

export const noConsentUserName = 'No Consent User';
export const noConsentUserEmail = randomEmail('no-consent');

export const invalidEmailFormatErrorMessage = 'Enter a valid email address';
export const emptyNameErrorMessage = 'Enter your name';

export const testInboxHeading = 'Test inbox';
export const registrationCancelledMessage = 'Registration cancelled';
export const initialMessageCount = 1;
export const allMessagesCount = 5;