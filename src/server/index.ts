import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import swaggerUi from 'swagger-ui-express';
import { parse } from 'yaml';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { transform } from 'esbuild';
import {
  cancelByToken,
  countConfirmed,
  createRegistration,
  getEvent,
  getMessages,
  getRegistrations,
  patchRegistration,
  resetStore,
} from './store.js';

const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(currentDir, '..', '..');
const clientDir = join(projectRoot, 'src', 'client');
const openApiText = await readFile(join(currentDir, 'openapi.yaml'), 'utf8');
const openApiDocument = parse(openApiText) as object;
const clientSource = await readFile(join(clientDir, 'app.ts'), 'utf8');
const clientBundle = await transform(clientSource, {
  loader: 'ts',
  format: 'esm',
  target: 'es2022',
  sourcemap: 'inline',
});

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(express.json({ limit: '1mb' }));
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok' });
});

app.get('/api/events', (_request, response) => {
  const event = getEvent();
  response.json([
    {
      ...event,
      confirmed: countConfirmed(),
      placesRemaining: Math.max(event.capacity - countConfirmed(), 0),
    },
  ]);
});

app.get('/api/events/:eventId', async (request, response) => {
  const event = getEvent();
  if (request.params.eventId !== event.id) {
    response.status(404).json({ message: 'Event not found' });
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, 1_150));
  const registrations = getRegistrations();
  response.json({
    ...event,
    confirmed: countConfirmed(),
    placesRemaining: Math.max(event.capacity - countConfirmed(), 0),
    waitListCount: registrations.filter((registration) => registration.status === 'waiting').length,
    attendees: registrations
      .filter((registration) => registration.status !== 'cancelled')
      .map((registration) => ({
        name: registration.name,
        email: registration.email,
        dietaryRequirements: registration.dietaryRequirements,
        accessibilityNeeds: registration.accessibilityNeeds,
        status: registration.status,
      })),
  });
});

app.post('/api/events/:eventId/registrations', async (request, response, next) => {
  try {
    if (request.params.eventId !== getEvent().id) {
      response.status(404).json({ message: 'Event not found' });
      return;
    }
    const registration = await createRegistration(request.body as Record<string, unknown>);
    response.status(201).json(registration);
  } catch (error) {
    next(error);
  }
});

app.patch('/api/events/:eventId/registrations/:registrationId', async (request, response, next) => {
  try {
    if (request.params.eventId !== getEvent().id) {
      response.status(404).json({ message: 'Event not found' });
      return;
    }
    const registration = patchRegistration(request.params.registrationId, request.body as Record<string, unknown>);
    response.json(registration);
  } catch (error) {
    next(error);
  }
});

app.post('/api/cancellations/:token', (request, response, next) => {
  try {
    response.json(cancelByToken(request.params.token));
  } catch (error) {
    next(error);
  }
});

app.get('/api/messages', (_request, response) => {
  response.json(getMessages());
});

app.post('/api/reset', (_request, response) => {
  resetStore();
  response.status(204).send();
});

app.get('/assets/app.js', (_request, response) => {
  response.type('application/javascript').send(clientBundle.code);
});

app.get('/assets/styles.css', async (_request, response, next) => {
  try {
    response.type('text/css').send(await readFile(join(clientDir, 'styles.css'), 'utf8'));
  } catch (error) {
    next(error);
  }
});

app.get(['/', '/inbox', '/cancel'], async (_request, response, next) => {
  try {
    response.type('html').send(await readFile(join(clientDir, 'index.html'), 'utf8'));
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error
    ? Number((error as { statusCode: unknown }).statusCode)
    : 400;
  const message = error instanceof Error ? error.message : 'Request failed';
  response.status(statusCode).json({ message });
});

app.listen(port, '127.0.0.1', () => {
  console.log(`Event registration assessment running at http://127.0.0.1:${port}`);
});
