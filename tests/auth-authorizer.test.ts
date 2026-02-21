import type { APIGatewayRequestAuthorizerEvent } from 'aws-lambda';

jest.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: {
    create: jest.fn()
  }
}));

const makeToken = (payload: Record<string, unknown>) => {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64');
  return `${header}.${body}.sig`;
};

const buildEvent = (options: {
  methodArn: string;
  headers?: Record<string, string>;
}): APIGatewayRequestAuthorizerEvent =>
  ({
    type: 'REQUEST',
    methodArn: options.methodArn,
    resource: '',
    path: '',
    httpMethod: '',
    headers: options.headers || {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    requestContext: {} as never,
    body: null,
    isBase64Encoded: false
  }) as APIGatewayRequestAuthorizerEvent;

const loadHandler = () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const module = require('../services/auth-authorizer/src/handler');
  return module.handler as (event: APIGatewayRequestAuthorizerEvent) => Promise<unknown>;
};

const setEnv = (vars: Record<string, string | undefined>) => {
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
};

describe('auth authorizer', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    setEnv({
      STAGE: 'dev',
      COGNITO_USER_POOL_ID: undefined,
      COGNITO_CLIENT_ID: undefined,
      INGEST_AUTH_REQUIRED: undefined,
      TENANT_CLAIM_KEY: undefined
    });
  });

  it('allows dev when no user pool is configured', async () => {
    const handler = loadHandler();
    const event = buildEvent({
      methodArn: 'arn:aws:execute-api:us-east-1:123456789012:apiId/dev/GET/v1/incidents'
    });

    const result = (await handler(event)) as { principalId: string; context?: Record<string, string> };
    expect(result.principalId).toBe('dev-anon');
    expect(result.context?.mode).toBe('dev');
  });

  it('denies in prod when no user pool is configured', async () => {
    setEnv({ STAGE: 'prod' });
    const handler = loadHandler();
    const event = buildEvent({
      methodArn: 'arn:aws:execute-api:us-east-1:123456789012:apiId/prod/GET/v1/incidents'
    });

    await expect(handler(event)).rejects.toThrow('Unauthorized');
  });

  it('allows ingest without auth when ingest auth is disabled', async () => {
    setEnv({ COGNITO_USER_POOL_ID: 'pool-1', INGEST_AUTH_REQUIRED: 'false' });
    const handler = loadHandler();
    const event = buildEvent({
      methodArn: 'arn:aws:execute-api:us-east-1:123456789012:apiId/dev/POST/v1/events'
    });

    const result = (await handler(event)) as { context?: Record<string, string> };
    expect(result.context?.mode).toBe('optional');
  });

  it('denies when auth is required and token is missing', async () => {
    setEnv({ COGNITO_USER_POOL_ID: 'pool-2', INGEST_AUTH_REQUIRED: 'true' });
    const handler = loadHandler();
    const event = buildEvent({
      methodArn: 'arn:aws:execute-api:us-east-1:123456789012:apiId/dev/GET/v1/incidents'
    });

    await expect(handler(event)).rejects.toThrow('Unauthorized');
  });

  it('denies when tenant header is missing', async () => {
    setEnv({ COGNITO_USER_POOL_ID: 'pool-3', COGNITO_CLIENT_ID: 'client-1' });
    const token = makeToken({ token_use: 'access' });
    const { CognitoJwtVerifier } = require('aws-jwt-verify');
    (CognitoJwtVerifier.create as jest.Mock).mockReturnValue({
      verify: jest.fn().mockResolvedValue({
        sub: 'user-1',
        token_use: 'access',
        client_id: 'client-1',
        'custom:tenantId': 'tenant-1'
      })
    });

    const handler = loadHandler();
    const event = buildEvent({
      methodArn: 'arn:aws:execute-api:us-east-1:123456789012:apiId/dev/GET/v1/incidents',
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    await expect(handler(event)).rejects.toThrow('Unauthorized');
  });

  it('denies when tenant claim does not match header', async () => {
    setEnv({ COGNITO_USER_POOL_ID: 'pool-4', COGNITO_CLIENT_ID: 'client-2' });
    const token = makeToken({ token_use: 'access' });
    const { CognitoJwtVerifier } = require('aws-jwt-verify');
    (CognitoJwtVerifier.create as jest.Mock).mockReturnValue({
      verify: jest.fn().mockResolvedValue({
        sub: 'user-2',
        token_use: 'access',
        client_id: 'client-2',
        'custom:tenantId': 'tenant-1'
      })
    });

    const handler = loadHandler();
    const event = buildEvent({
      methodArn: 'arn:aws:execute-api:us-east-1:123456789012:apiId/dev/GET/v1/incidents',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Tenant-Id': 'tenant-2'
      }
    });

    await expect(handler(event)).rejects.toThrow('Unauthorized');
  });

  it('allows when tenant claim matches header', async () => {
    setEnv({ COGNITO_USER_POOL_ID: 'pool-5', COGNITO_CLIENT_ID: 'client-3' });
    const token = makeToken({ token_use: 'access' });
    const { CognitoJwtVerifier } = require('aws-jwt-verify');
    (CognitoJwtVerifier.create as jest.Mock).mockReturnValue({
      verify: jest.fn().mockResolvedValue({
        sub: 'user-3',
        token_use: 'access',
        client_id: 'client-3',
        'custom:tenantId': 'tenant-1'
      })
    });

    const handler = loadHandler();
    const event = buildEvent({
      methodArn: 'arn:aws:execute-api:us-east-1:123456789012:apiId/dev/GET/v1/incidents',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Tenant-Id': 'tenant-1'
      }
    });

    const result = (await handler(event)) as { context?: Record<string, string> };
    expect(result.context?.tenantId).toBe('tenant-1');
  });
});
