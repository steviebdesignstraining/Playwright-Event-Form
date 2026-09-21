export type RegistrationStatus = 'confirmed' | 'waiting' | 'cancelled';

export interface EventRecord {
  id: string;
  title: string;
  summary: string;
  venue: string;
  startsAt: string;
  capacity: number;
}

export interface Registration {
  id: string;
  eventId: string;
  name?: string;
  email: string;
  organisation?: string;
  dietaryRequirements?: string;
  accessibilityNeeds?: string;
  marketingConsent?: boolean;
  status: RegistrationStatus;
  createdAt: string;
  cancellationToken: string;
}

export interface Message {
  id: string;
  to: string;
  subject: string;
  bodyHtml: string;
  createdAt: string;
}

export interface RegistrationInput {
  name?: unknown;
  email?: unknown;
  organisation?: unknown;
  dietaryRequirements?: unknown;
  accessibilityNeeds?: unknown;
  marketingConsent?: unknown;
}
