import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, buildHeaders, listIncidents, normalizeBaseUrl } from './api';

describe('normalizeBaseUrl', () => {
  it('removes trailing slashes', () => {
    expect(normalizeBaseUrl('https://api.example.com/')).toBe('https://api.example.com');
    expect(normalizeBaseUrl('https://api.example.com////')).toBe('https://api.example.com');
  });

  it('keeps base url unchanged when no trailing slash', () => {
    expect(normalizeBaseUrl('https://api.example.com/prod')).toBe('https://api.example.com/prod');
  });
});

describe('buildHeaders', () => {
  it('includes content type by default', () => {
    const headers = buildHeaders();
    expect(headers['content-type']).toBe('application/json');
    expect(headers.authorization).toBeUndefined();
  });

  it('adds bearer token when provided', () => {
    const headers = buildHeaders('token-123');
    expect(headers.authorization).toBe('Bearer token-123');
  });
});

describe('request errors', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws ApiRequestError with details on failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      return {
        ok: false,
        status: 409,
        statusText: 'Conflict',
        json: async () => ({ error: 'conflict' })
      } as Response;
    }));

    await expect(listIncidents({ baseUrl: 'http://localhost:3000' }, {})).rejects.toBeInstanceOf(ApiRequestError);

    try {
      await listIncidents({ baseUrl: 'http://localhost:3000' }, {});
    } catch (error) {
      const apiError = error as ApiRequestError;
      expect(apiError.status).toBe(409);
      expect(apiError.message).toBe('conflict');
    }
  });
});
