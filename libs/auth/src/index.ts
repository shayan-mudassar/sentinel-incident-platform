import type { APIGatewayProxyEvent } from 'aws-lambda';

export type UserContext = {
  isAuthenticated: boolean;
  userId?: string;
  email?: string;
  roles: string[];
  tenantId?: string;
  mode?: string;
};

const normalizeRoles = (value?: string): string[] => {
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map((role) => role.trim())
    .filter((role) => role.length > 0)
    .map((role) => role.toUpperCase());
};

export const getUserContextFromEvent = (event: APIGatewayProxyEvent): UserContext => {
  const authorizer = event.requestContext?.authorizer || {};
  const userId = (authorizer.sub || authorizer.userId || authorizer.cognitoUsername) as string | undefined;
  const email = authorizer.email as string | undefined;
  const rolesRaw = (authorizer.roles || authorizer.groups || authorizer['cognito:groups']) as
    | string
    | undefined;
  const roles = normalizeRoles(rolesRaw);
  const tenantId = authorizer.tenantId as string | undefined;
  const mode = authorizer.mode as string | undefined;

  return {
    isAuthenticated: Boolean(userId),
    userId,
    email,
    roles,
    tenantId,
    mode
  };
};

export const requireAuth = (context: UserContext) => context.isAuthenticated;

export const requireRole = (context: UserContext, role: string) =>
  context.roles.includes(role.toUpperCase());

export const isAdmin = (context: UserContext) => requireRole(context, 'ADMIN');
