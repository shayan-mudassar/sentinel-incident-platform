import { APIGatewayProxyResult } from 'aws-lambda';

export type ErrorCode =
  | 'validation_error'
  | 'auth_required'
  | 'auth_invalid'
  | 'not_found'
  | 'conflict'
  | 'internal_error';

export type ErrorResponse = {
  error: ErrorCode;
  message?: string;
  details?: unknown;
};

export const buildResponse = (
  statusCode: number,
  body: Record<string, unknown>,
  headers?: Record<string, string>
): APIGatewayProxyResult => {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
      ...(headers || {})
    },
    body: JSON.stringify(body)
  };
};

export const buildError = (
  statusCode: number,
  error: ErrorCode,
  message?: string,
  details?: unknown
): APIGatewayProxyResult => {
  const payload: ErrorResponse = { error };
  if (message) {
    payload.message = message;
  }
  if (details !== undefined) {
    payload.details = details;
  }
  return buildResponse(statusCode, payload as Record<string, unknown>);
};

export const getHeader = (
  headers: Record<string, string | undefined> | null | undefined,
  name: string
): string | undefined => {
  if (!headers) {
    return undefined;
  }
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) {
      return value;
    }
  }
  return undefined;
};

export const parseTenantId = (
  headers: Record<string, string | undefined> | null | undefined
): string | undefined => {
  const raw = getHeader(headers, 'x-tenant-id');
  if (!raw) {
    return undefined;
  }
  const tenantId = raw.trim();
  return tenantId.length > 0 ? tenantId : undefined;
};

export const hasAuthHeader = (
  headers: Record<string, string | undefined> | null | undefined
): boolean => {
  const value = getHeader(headers, 'authorization');
  return Boolean(value && value.trim().length > 0);
};
