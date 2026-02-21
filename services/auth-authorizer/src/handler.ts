import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { APIGatewayTokenAuthorizerEvent, APIGatewayAuthorizerResult } from 'aws-lambda';

type JwtPayload = {
  sub?: string;
  token_use?: string;
  aud?: string;
  client_id?: string;
  [key: string]: unknown;
};

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

const getJwks = (issuer: string) => {
  const cached = jwksCache.get(issuer);
  if (cached) {
    return cached;
  }
  const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  jwksCache.set(issuer, jwks);
  return jwks;
};

const parseMethodArn = (methodArn: string) => {
  const arnParts = methodArn.split(':');
  const apiGatewayArn = arnParts[5] || '';
  const apiGatewayArnParts = apiGatewayArn.split('/');
  const httpMethod = apiGatewayArnParts[2] || '';
  const resourcePath = `/${apiGatewayArnParts.slice(3).join('/')}`.replace(/\/$/, '/') || '/';
  return { httpMethod, resourcePath };
};

const getBearerToken = (authorizationToken?: string | null) => {
  if (!authorizationToken) {
    return null;
  }
  const trimmed = authorizationToken.trim();
  if (!trimmed) {
    return null;
  }
  const [scheme, value] = trimmed.split(' ');
  if (value && scheme.toLowerCase() === 'bearer') {
    return value.trim();
  }
  return trimmed;
};

const requiresAuth = (methodArn: string) => {
  const { httpMethod, resourcePath } = parseMethodArn(methodArn);
  if (httpMethod.toUpperCase() === 'OPTIONS') {
    return false;
  }

  const userPoolId = process.env.COGNITO_USER_POOL_ID?.trim();
  if (!userPoolId) {
    return false;
  }

  const ingestAuthRequired = process.env.INGEST_AUTH_REQUIRED === 'true';
  if (resourcePath.startsWith('/v1/events')) {
    return ingestAuthRequired;
  }

  return true;
};

const verifyJwt = async (token: string): Promise<JwtPayload> => {
  const userPoolId = process.env.COGNITO_USER_POOL_ID?.trim();
  if (!userPoolId) {
    throw new Error('missing_user_pool');
  }

  const region = process.env.AWS_REGION || 'us-east-1';
  const issuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
  const jwks = getJwks(issuer);
  const { payload } = await jwtVerify(token, jwks, { issuer });

  const tokenUse = payload.token_use;
  if (tokenUse !== 'id' && tokenUse !== 'access') {
    throw new Error('invalid_token_use');
  }

  const clientId = process.env.COGNITO_CLIENT_ID?.trim();
  if (clientId) {
    if (tokenUse === 'id' && payload.aud !== clientId) {
      throw new Error('invalid_audience');
    }
    if (tokenUse === 'access' && payload.client_id !== clientId) {
      throw new Error('invalid_client');
    }
  }

  return payload as JwtPayload;
};

const buildPolicy = (
  principalId: string,
  effect: 'Allow' | 'Deny',
  resource: string,
  context?: Record<string, string>
): APIGatewayAuthorizerResult => ({
  principalId,
  policyDocument: {
    Version: '2012-10-17',
    Statement: [
      {
        Action: 'execute-api:Invoke',
        Effect: effect,
        Resource: resource
      }
    ]
  },
  context
});

export const handler = async (event: APIGatewayTokenAuthorizerEvent) => {
  const stage = process.env.STAGE || 'dev';
  const userPoolId = process.env.COGNITO_USER_POOL_ID?.trim();

  if (!userPoolId) {
    if (stage === 'prod') {
      throw new Error('Unauthorized');
    }
    return buildPolicy('dev-anon', 'Allow', event.methodArn, { mode: 'dev' });
  }

  if (!requiresAuth(event.methodArn)) {
    return buildPolicy('optional-auth', 'Allow', event.methodArn, { mode: 'optional' });
  }

  const token = getBearerToken(event.authorizationToken);
  if (!token) {
    throw new Error('Unauthorized');
  }

  try {
    const payload = await verifyJwt(token);
    const principalId = payload.sub || 'user';
    const context: Record<string, string> = {};
    if (typeof payload.sub === 'string') {
      context.sub = payload.sub;
    }
    if (typeof payload.username === 'string') {
      context.username = payload.username;
    }
    if (typeof payload['cognito:username'] === 'string') {
      context.cognitoUsername = payload['cognito:username'] as string;
    }
    if (typeof payload.token_use === 'string') {
      context.tokenUse = payload.token_use;
    }

    return buildPolicy(principalId, 'Allow', event.methodArn, context);
  } catch (error) {
    throw new Error('Unauthorized');
  }
};
