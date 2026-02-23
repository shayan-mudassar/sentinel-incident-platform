export {};

import {
  badRequest,
  buildResponse,
  getRequestId,
  hasAuthHeader,
  ok,
  parseTenantId
} from '@sentinel/http';

describe('http utils', () => {
  it('buildResponse wraps payload as json', () => {
    const response = buildResponse(201, { ok: true }, { requestId: 'req-1' });
    expect(response.statusCode).toBe(201);
    expect(response.headers?.['content-type']).toBe('application/json');
    expect(response.headers?.['X-Request-Id']).toBe('req-1');
    expect(JSON.parse(response.body)).toEqual({ ok: true });
  });

  it('badRequest includes message and details', () => {
    const response = badRequest('invalid', 'bad', ['field'], { requestId: 'req-2' });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: {
        code: 'invalid',
        message: 'bad',
        details: ['field'],
        requestId: 'req-2'
      }
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

  it('getRequestId prefers header over requestContext', () => {
    expect(
      getRequestId({
        headers: { 'X-Request-Id': 'req-header' },
        requestContext: { requestId: 'req-context' }
      })
    ).toBe('req-header');
    expect(
      getRequestId({
        headers: {},
        requestContext: { requestId: 'req-context' }
      })
    ).toBe('req-context');
  });
});
