import { APIGatewayProxyResult } from 'aws-lambda';

export type ErrorCode =
  | 'validation_error'
  | 'auth_required'
  | 'auth_invalid'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'internal_error'
  | (string & {});

export type ErrorEnvelope = {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
    requestId?: string;
  };
};

type ResponseOptions = {
  requestId?: string;
  headers?: Record<string, string>;
};

const withHeaders = (options?: ResponseOptions) => {
  const headers: Record<string, string> = {
    'content-type': 'application/json'
  };
  if (options?.requestId) {
    headers['X-Request-Id'] = options.requestId;
  }
  return {
    ...headers,
    ...(options?.headers || {})
  };
};

export const buildResponse = (
  statusCode: number,
  body: Record<string, unknown> | null,
  options?: ResponseOptions
): APIGatewayProxyResult => {
  return {
    statusCode,
    headers: withHeaders(options),
    body: body ? JSON.stringify(body) : ''
  };
};

export const ok = (body: Record<string, unknown>, options?: ResponseOptions) =>
  buildResponse(200, body, options);

export const created = (body: Record<string, unknown>, options?: ResponseOptions) =>
  buildResponse(201, body, options);

export const noContent = (options?: ResponseOptions): APIGatewayProxyResult => ({
  statusCode: 204,
  headers: withHeaders(options),
  body: ''
});

export const buildError = (
  statusCode: number,
  error: ErrorCode,
  message: string,
  details?: unknown,
  options?: ResponseOptions
): APIGatewayProxyResult => {
  const payload: ErrorEnvelope = {
    error: {
      code: error,
      message,
      requestId: options?.requestId
    }
  };
  if (details !== undefined) {
    payload.error.details = details;
  }
  return buildResponse(statusCode, payload as Record<string, unknown>, options);
};

export const badRequest = (code: ErrorCode, message: string, details?: unknown, options?: ResponseOptions) =>
  buildError(400, code, message, details, options);

export const unauthorized = (code: ErrorCode, message: string, options?: ResponseOptions) =>
  buildError(401, code, message, undefined, options);

export const forbidden = (code: ErrorCode, message: string, options?: ResponseOptions) =>
  buildError(403, code, message, undefined, options);

export const notFound = (code: ErrorCode, message: string, options?: ResponseOptions) =>
  buildError(404, code, message, undefined, options);

export const conflict = (code: ErrorCode, message: string, options?: ResponseOptions) =>
  buildError(409, code, message, undefined, options);

export const internalError = (code: ErrorCode, message: string, options?: ResponseOptions) =>
  buildError(500, code, message, undefined, options);

export const notImplemented = (code: ErrorCode, message: string, options?: ResponseOptions) =>
  buildError(501, code, message, undefined, options);

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

export const getRequestId = (event: {
  headers?: Record<string, string | undefined> | null;
  requestContext?: { requestId?: string };
}): string | undefined => {
  const headerRequestId = getHeader(event.headers, 'x-request-id');
  if (headerRequestId) {
    return headerRequestId;
  }
  return event.requestContext?.requestId;
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
