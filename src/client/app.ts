interface EventDetails {
  id: string;
  title: string;
  summary: string;
  venue: string;
  startsAt: string;
  capacity: number;
  confirmed: number;
  placesRemaining: number;
  waitListCount: number;
}

interface RegistrationResult {
  id: string;
  name?: string;
  email: string;
  status: 'confirmed' | 'waiting';
}

interface Message {
  id: string;
  to: string;
  subject: string;
  bodyHtml: string;
  createdAt: string;
}

const mainElement = document.querySelector<HTMLElement>('#main-content');
if (!mainElement) throw new Error('Main content element is missing');
const main: HTMLElement = mainElement;

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
}

function field(name: string, label: string, type = 'text', required = false): string {
  return `
    <div class="field">
      <span class="field-label">${label}${required ? ' *' : ''}</span>
      <input name="${name}" type="${type}" ${required ? 'required' : ''} />
      <div class="field-error" data-error-for="${name}"></div>
    </div>`;
}

async function renderEvent(): Promise<void> {
  main.innerHTML = `
    <section class="loading-panel">
      <h1>Upcoming event</h1>
      <p>Loading event...</p>
    </section>`;

  try {
    const response = await fetch('/api/events/future-of-work-2026');
    if (!response.ok) throw new Error('Unable to load event');
    const event = (await response.json()) as EventDetails;
    const eventDate = new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(new Date(event.startsAt));

    main.innerHTML = `
      <div class="event-layout">
        <article class="event-card">
          <p class="eyebrow">Free one-day forum</p>
          <h1>${event.title}</h1>
          <p class="lede">${event.summary}</p>
          <dl class="event-details">
            <div><dt>Date</dt><dd>${eventDate}</dd></div>
            <div><dt>Venue</dt><dd>${event.venue}</dd></div>
          </dl>

          <section aria-labelledby="registration-heading">
            <h2 id="registration-heading">Register as a guest</h2>
            <p>Fields marked * are required.</p>
            <div id="form-errors" class="error-summary"></div>
            <form id="registration-form" novalidate>
              ${field('name', 'Name', 'text', true)}
              ${field('email', 'Email address', 'email', true)}
              ${field('organisation', 'Organisation')}
              <div class="field">
                <span class="field-label">Dietary requirements</span>
                <textarea name="dietaryRequirements"></textarea>
              </div>
              <div class="field">
                <span class="field-label">Accessibility needs</span>
                <textarea name="accessibilityNeeds"></textarea>
              </div>
              <div class="consent-row">
                <input name="marketingConsent" type="checkbox" />
                <span>Send me news about future events</span>
              </div>
              <button class="primary-button" type="submit">Register</button>
            </form>
            <div id="registration-result" class="registration-result"></div>
          </section>
        </article>

        <aside class="availability-card">
          <p class="availability-number">${event.placesRemaining}</p>
          <p>${event.placesRemaining === 1 ? 'place' : 'places'} remaining</p>
          <p class="muted">${event.waitListCount} currently waiting</p>
        </aside>
      </div>`;

    document.querySelector<HTMLFormElement>('#registration-form')?.addEventListener('submit', submitRegistration);
  } catch {
    main.innerHTML = `<section class="error-page"><h1>Something went wrong</h1><p>Please try again later.</p></section>`;
  }
}

function showFormErrors(form: HTMLFormElement): boolean {
  const errors: string[] = [];
  const name = form.elements.namedItem('name') as HTMLInputElement;
  const email = form.elements.namedItem('email') as HTMLInputElement;
  document.querySelectorAll('.field-error').forEach((element) => { element.textContent = ''; });

  if (!name.value.trim()) {
    errors.push('Enter your name');
    document.querySelector('[data-error-for="name"]')!.textContent = 'Enter your name';
  }
  if (!email.value.includes('@')) {
    errors.push('Enter a valid email address');
    document.querySelector('[data-error-for="email"]')!.textContent = 'Enter a valid email address';
  }

  const summary = document.querySelector<HTMLElement>('#form-errors')!;
  summary.innerHTML = errors.length ? `<strong>There is a problem</strong><ul>${errors.map((error) => `<li>${error}</li>`).join('')}</ul>` : '';
  return errors.length === 0;
}

async function submitRegistration(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  if (!showFormErrors(form)) return;

  const data = new FormData(form);
  const response = await fetch('/api/events/future-of-work-2026/registrations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: data.get('name'),
      email: data.get('email'),
      organisation: data.get('organisation'),
      dietaryRequirements: data.get('dietaryRequirements'),
      accessibilityNeeds: data.get('accessibilityNeeds'),
      marketingConsent: data.get('marketingConsent') === 'on',
    }),
  });

  const result = document.querySelector<HTMLElement>('#registration-result')!;
  const payload = (await response.json()) as RegistrationResult | { message: string };
  if (!response.ok) {
    result.innerHTML = `<p class="error-message">${'message' in payload ? payload.message : 'Registration failed'}</p>`;
    return;
  }

  const registration = payload as RegistrationResult;
  result.innerHTML = `
    <h3>${registration.status === 'confirmed' ? 'You are registered' : 'You are on the waiting list'}</h3>
    <p>Thank you, ${registration.name}. We have created an entry for ${registration.email}.</p>
    <p><a href="/inbox?email=${escapeAttribute(registration.email)}">Open the test inbox</a></p>`;
  form.reset();
}

async function renderInbox(): Promise<void> {
  const response = await fetch('/api/messages');
  const allMessages = (await response.json()) as Message[];
  const email = new URLSearchParams(window.location.search).get('email');
  const messages = email ? allMessages.filter((message) => message.to.toLowerCase() === email.toLowerCase()) : allMessages;

  main.innerHTML = `
    <section class="inbox-page">
      <p class="eyebrow">Local delivery substitute</p>
      <h1>Test inbox</h1>
      <p>Messages generated by the release candidate appear here because no SMTP service is connected.</p>
      ${email ? `<p>Showing messages for <strong>${email}</strong>. <a href="/inbox">Show all</a></p>` : ''}
      <div class="message-list">
        ${messages.map((message) => `
          <article class="message-card">
            <p><strong>To:</strong> ${message.to}</p>
            <h2>${message.subject}</h2>
            <div>${message.bodyHtml}</div>
          </article>`).join('') || '<p>No messages found.</p>'}
      </div>
    </section>`;
}

async function renderCancellation(): Promise<void> {
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  main.innerHTML = `
    <section class="cancel-page">
      <h1>Cancel your registration</h1>
      <p>This will release your event place.</p>
      <button id="confirm-cancel" class="danger-button" type="button">Confirm cancellation</button>
      <div id="cancel-result"></div>
    </section>`;

  document.querySelector<HTMLButtonElement>('#confirm-cancel')?.addEventListener('click', async () => {
    const response = await fetch(`/api/cancellations/${encodeURIComponent(token)}`, { method: 'POST' });
    const payload = (await response.json()) as { message?: string };
    const result = document.querySelector<HTMLElement>('#cancel-result')!;
    result.innerHTML = response.ok
      ? '<h2>Registration cancelled</h2><p>Your place has been released.</p>'
      : `<p class="error-message">${payload.message ?? 'Cancellation failed'}</p>`;
  });
}

if (window.location.pathname === '/inbox') {
  void renderInbox();
} else if (window.location.pathname === '/cancel') {
  void renderCancellation();
} else {
  void renderEvent();
}
