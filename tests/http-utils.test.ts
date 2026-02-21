export {};

import { buildError, buildResponse, hasAuthHeader, parseTenantId } from '@sentinel/http';

describe('http utils', () => {
  it('buildResponse wraps payload as json', () => {
    const response = buildResponse(201, { ok: true });
    expect(response.statusCode).toBe(201);
    expect(response.headers?.['content-type']).toBe('application/json');
    expect(JSON.parse(response.body)).toEqual({ ok: true });
  });

  it('buildError includes message and details', () => {
    const response = buildError(400, 'validation_error', 'bad', ['field']);
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: 'validation_error',
      message: 'bad',
      details: ['field']
    });
  });

  it('parseTenantId trims and handles casing', () => {
    expect(parseTenantId({ 'X-Tenant-Id': ' tenant-1 ' })).toBe('tenant-1');
    expect(parseTenantId({ 'x-tenant-id': 'tenant-2' })).toBe('tenant-2');
    expect(parseTenantId({})).toBeUndefined();
    expect(parseTenantId({ 'X-Tenant-Id': '   ' })).toBeUndefined();
  });

  it('hasAuthHeader checks authorization presence', () => {
    expect(hasAuthHeader({ Authorization: 'Bearer abc' })).toBe(true);
    expect(hasAuthHeader({ authorization: 'token' })).toBe(true);
    expect(hasAuthHeader({ authorization: '   ' })).toBe(false);
    expect(hasAuthHeader(undefined)).toBe(false);
  });
});
