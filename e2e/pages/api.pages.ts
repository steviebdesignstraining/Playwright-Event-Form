import { type APIRequestContext, type APIResponse } from '@playwright/test';
import { EVENT_ID } from '../test-data/apiTestdata.data.ts';

export class ApiPage {
  readonly request: APIRequestContext;
  readonly apiUrl: string;

  constructor(request: APIRequestContext) {
    this.request = request;
    this.apiUrl = process.env.API_URL || 'http://127.0.0.1:3000/api';
  }

  async getHealth(): Promise<APIResponse> {
    return this.request.get(`${this.apiUrl}/health`);
  }

  async getEvents(): Promise<APIResponse> {
    return this.request.get(`${this.apiUrl}/events`);
  }

  async getEvent(eventId: string): Promise<APIResponse> {
    return this.request.get(`${this.apiUrl}/events/${eventId}`);
  }

  async createRegistration(eventId: string, data: Record<string, unknown>): Promise<APIResponse> {
    return this.request.post(`${this.apiUrl}/events/${eventId}/registrations`, {
      data,
    });
  }

  async cancelRegistration(token: string): Promise<APIResponse> {
    return this.request.post(`${this.apiUrl}/cancellations/${token}`);
  }

  async getMessages(): Promise<APIResponse> {
    return this.request.get(`${this.apiUrl}/messages`);
  }

  async updateRegistration(eventId: string, registrationId: string, data: Record<string, unknown>): Promise<APIResponse> {
    return this.request.patch(`${this.apiUrl}/events/${eventId}/registrations/${registrationId}`, {
      data,
    });
  }

  async resetStore(): Promise<APIResponse> {
    return this.request.post(`${this.apiUrl}/reset`);
  }
}
