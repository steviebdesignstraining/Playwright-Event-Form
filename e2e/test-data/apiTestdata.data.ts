export const EVENT_ID = 'future-of-work-2026';
export const INVALID_EVENT_ID = 'invalid-event-id';
export const INVALID_TOKEN = 'invalid-token';
export const EMPTY_TOKEN = '';

export function randomEmail(prefix = 'user'): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${random}@example.com`;
}

export const registrationPayload = {
  name: 'Stephen Bennett',
  email: randomEmail('stephen'),
};

export const expectedConfirmedRegistration = {
  name: 'Stephen Bennett',
  status: 'confirmed',
};

export const validRegistration = {
  name: 'Stephen Bennett',
  email: randomEmail('stephen'),
  organisation: 'Acme Studio',
  dietaryRequirements: 'Nut allergy',
  accessibilityNeeds: 'Step-free access',
  marketingConsent: true,
};

export const validRegistrationMinimal = {
  name: 'Jane Doe',
  email: randomEmail('jane'),
};

export const invalidRegistrationEmptyName = {
  name: '',
  email: randomEmail('empty-name'),
};

export const invalidRegistrationEmptyEmail = {
  name: 'Test User',
  email: '',
};

export const invalidRegistrationBadEmail = {
  name: 'Test User',
  email: 'invalid-email',
};

export const invalidRegistrationMissingName = {
  email: randomEmail('missing-name'),
};

export const invalidRegistrationMissingEmail = {
  name: 'Test User',
};

export const waitingListRegistration = {
  name: 'Waiting User',
  email: randomEmail('waiting'),
};

export const cancellationSuccessMessage = 'Registration cancelled';

export const duplicateRegistrationErrorMessage = 'already registered';
export const eventNotFoundMessage = 'Event not found';
export const cancellationNotFoundMessage = 'not found';

export const registrationPatchPayload = {
  dietaryRequirements: 'Gluten free',
  accessibilityNeeds: 'Wheelchair access',
};

export const invalidUpdatePayload = {
  name: 'New Name',
};

export const invalidFieldsErrorMessage = 'Invalid fields';

export const statusConfirmed = 'confirmed';
export const statusWaiting = 'waiting';
export const statusCancelled = 'cancelled';

export const registrationNotFoundMessage = 'Registration not found';

export const partialUpdatePayload = {
  organisation: 'New Org',
};

export const emailPrefixes = {
  capacity: 'capacity',
  waitlistCount: 'waitlist-count',
  promote: 'promote',
  toCancel: 'to-cancel',
  cancelWaiting: 'cancel-waiting',
  genericUser: 'User',
};

export const validRegistrationStatuses = ['confirmed', 'waiting'];