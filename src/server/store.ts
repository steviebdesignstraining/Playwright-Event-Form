import type { EventRecord, Message, Registration, RegistrationInput } from './types.js';

const eventSeed: EventRecord = {
  id: 'future-of-work-2026',
  title: 'The Human Future of Work',
  summary: 'A practical one-day forum for people designing humane digital services.',
  venue: 'The Foundry, Leeds',
  startsAt: '2026-10-20 09:30:00',
  capacity: 3,
};

let event: EventRecord;
let registrations: Registration[];
let messages: Message[];
let nextRegistrationId: number;
let nextMessageId: number;

function confirmationMessage(registration: Registration): Message {
  return {
    id: `msg-${nextMessageId++}`,
    to: registration.email,
    subject: 'Your event place is confirmed',
    bodyHtml: `<p>Hello ${registration.name ?? ''},</p><p>Your place at <strong>${event.title}</strong> is confirmed.</p><p><a href="/cancel?token=${registration.cancellationToken}">Cancel your registration</a></p>`,
    createdAt: new Date().toISOString(),
  };
}

function waitingMessage(registration: Registration): Message {
  return {
    id: `msg-${nextMessageId++}`,
    to: registration.email,
    subject: 'You are on the waiting list',
    bodyHtml: `<p>Hello ${registration.name ?? ''},</p><p>You have joined the waiting list for <strong>${event.title}</strong>.</p>`,
    createdAt: new Date().toISOString(),
  };
}

function promotionMessage(registration: Registration): Message {
  return {
    id: `msg-${nextMessageId++}`,
    to: registration.email,
    subject: 'A place is now available',
    bodyHtml: `<p>Hello ${registration.name ?? ''},</p><p>You now have a confirmed place at <strong>${event.title}</strong>.</p><p><a href="/cancel?token=${registration.cancellationToken}">Cancel your registration</a></p>`,
    createdAt: new Date().toISOString(),
  };
}

export function resetStore(): void {
  event = { ...eventSeed };
  nextRegistrationId = 5;
  nextMessageId = 1;
  registrations = [
    {
      id: 'reg-1', eventId: event.id, name: 'Alice Morgan', email: 'alice@example.test', organisation: 'Northstar Co',
      dietaryRequirements: 'Vegan', accessibilityNeeds: '', marketingConsent: false, status: 'confirmed',
      createdAt: '2026-09-01T09:00:00.000Z', cancellationToken: '1001',
    },
    {
      id: 'reg-2', eventId: event.id, name: 'Ben Okafor', email: 'ben@example.test', organisation: 'Open Works',
      dietaryRequirements: '', accessibilityNeeds: 'Step-free access', marketingConsent: true, status: 'confirmed',
      createdAt: '2026-09-01T09:05:00.000Z', cancellationToken: '1002',
    },
    {
      id: 'reg-3', eventId: event.id, name: 'Cerys Jones', email: 'cerys@example.test', organisation: '',
      dietaryRequirements: '', accessibilityNeeds: '', marketingConsent: false, status: 'waiting',
      createdAt: '2026-09-01T09:10:00.000Z', cancellationToken: '1003',
    },
    {
      id: 'reg-4', eventId: event.id, name: 'Dev Shah', email: 'dev@example.test', organisation: 'Acme Studio',
      dietaryRequirements: 'Nut allergy', accessibilityNeeds: '', marketingConsent: false, status: 'waiting',
      createdAt: '2026-09-01T09:15:00.000Z', cancellationToken: '1004',
    },
  ];
  messages = registrations.map((registration) =>
    registration.status === 'confirmed' ? confirmationMessage(registration) : waitingMessage(registration),
  );
}

resetStore();

export function getEvent(): EventRecord {
  return { ...event };
}

export function getRegistrations(): Registration[] {
  return registrations.map((registration) => ({ ...registration }));
}

export function getMessages(): Message[] {
  return messages.map((message) => ({ ...message }));
}

export function countConfirmed(): number {
  return registrations.filter((registration) => registration.status === 'confirmed').length;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export async function createRegistration(input: RegistrationInput): Promise<Registration> {
  const email = text(input.email);
  if (!email) {
    throw new Error('Email is required');
  }

  const duplicate = registrations.find(
    (registration) => registration.eventId === event.id && registration.email === email && registration.status !== 'cancelled',
  );
  if (duplicate) {
    const error = new Error('This email is already registered');
    Object.assign(error, { statusCode: 409 });
    throw error;
  }

  const hasCapacity = countConfirmed() < event.capacity;
  await new Promise((resolve) => setTimeout(resolve, 90));

  const registration: Registration = {
    id: `reg-${nextRegistrationId}`,
    eventId: event.id,
    name: text(input.name),
    email,
    organisation: text(input.organisation),
    dietaryRequirements: text(input.dietaryRequirements),
    accessibilityNeeds: text(input.accessibilityNeeds),
    marketingConsent: input.marketingConsent === true,
    status: hasCapacity ? 'confirmed' : 'waiting',
    createdAt: new Date().toISOString(),
    cancellationToken: String(1000 + nextRegistrationId),
  };
  nextRegistrationId += 1;
  registrations.push(registration);
  messages.push(hasCapacity ? confirmationMessage(registration) : waitingMessage(registration));
  return { ...registration };
}

export function cancelByToken(token: string): { cancelled: Registration; promoted?: Registration } {
  const registration = registrations.find((candidate) => candidate.cancellationToken === token);
  if (!registration) {
    const error = new Error('Cancellation link not found');
    Object.assign(error, { statusCode: 404 });
    throw error;
  }

  const wasConfirmed = registration.status === 'confirmed';
  registration.status = 'cancelled';

  let promoted: Registration | undefined;
  const waiting = registrations.filter((candidate) => candidate.status === 'waiting');
  if (wasConfirmed || registration.status === 'cancelled') {
    promoted = waiting.at(-1);
    if (promoted) {
      promoted.status = 'confirmed';
      messages.push(promotionMessage(promoted));
    }
  }

  return {
    cancelled: { ...registration },
    promoted: promoted ? { ...promoted } : undefined,
  };
}

export function patchRegistration(
  registrationId: string,
  updates: Record<string, unknown>,
): Registration {
  const registration = registrations.find((candidate) => candidate.id === registrationId);
  if (!registration) {
    const error = new Error('Registration not found');
    Object.assign(error, { statusCode: 404 });
    throw error;
  }

  const allowedFields = ['dietaryRequirements', 'accessibilityNeeds', 'organisation', 'marketingConsent'];
  const requestedFields = Object.keys(updates);
  const invalidFields = requestedFields.filter((field) => !allowedFields.includes(field));
  if (invalidFields.length > 0) {
    const error = new Error(`Invalid fields: ${invalidFields.join(', ')}`);
    Object.assign(error, { statusCode: 400 });
    throw error;
  }

  if ('dietaryRequirements' in updates) {
    registration.dietaryRequirements = text(updates.dietaryRequirements) ?? undefined;
  }
  if ('accessibilityNeeds' in updates) {
    registration.accessibilityNeeds = text(updates.accessibilityNeeds) ?? undefined;
  }
  if ('organisation' in updates) {
    registration.organisation = text(updates.organisation) ?? undefined;
  }
  if ('marketingConsent' in updates) {
    registration.marketingConsent = updates.marketingConsent === true;
  }

  return { ...registration };
}
