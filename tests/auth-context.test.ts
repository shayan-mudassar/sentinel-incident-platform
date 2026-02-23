export {};

import { getUserContextFromEvent, isAdmin, requireAuth, requireRole } from '@sentinel/auth';

describe('auth context helpers', () => {
  it('parses roles and user identity', () => {
    const ctx = getUserContextFromEvent({
      requestContext: {
        authorizer: {
          sub: 'user-1',
          email: 'user@example.com',
          roles: 'ADMIN,User'
        }
      }
    } as never);

    expect(ctx.isAuthenticated).toBe(true);
    expect(ctx.userId).toBe('user-1');
    expect(ctx.email).toBe('user@example.com');
    expect(ctx.roles).toEqual(['ADMIN', 'USER']);
    expect(requireRole(ctx, 'ADMIN')).toBe(true);
    expect(isAdmin(ctx)).toBe(true);
    expect(requireAuth(ctx)).toBe(true);
  });

  it('handles missing authorizer', () => {
    const ctx = getUserContextFromEvent({ requestContext: {} } as never);
    expect(ctx.isAuthenticated).toBe(false);
    expect(ctx.roles).toEqual([]);
  });
});
