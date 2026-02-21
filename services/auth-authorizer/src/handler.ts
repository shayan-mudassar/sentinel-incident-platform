import { CognitoJwtVerifier } from 'aws-jwt-verify';
import type { CognitoJwtVerifierProperties, CognitoJwtVerifierSingleUserPool } from 'aws-jwt-verify/cognito-verifier';
import type { APIGatewayAuthorizerResult, APIGatewayRequestAuthorizerEvent } from 'aws-lambda';

type JwtPayload = {
  sub?: string;
  token_use?: string;
  aud?: string;
  client_id?: string;
  [key: string]: unknown;
};

type CognitoVerifier = CognitoJwtVerifierSingleUserPool<CognitoJwtVerifierProperties>;

const verifierCache = new Map<string, CognitoVerifier>();

const parseMethodArn = (methodArn: string) => {
  const arnParts = methodArn.split(':');
  const apiGatewayArn = arnParts[5] || '';
  const apiGatewayArnParts = apiGatewayArn.split('/');
  const httpMethod = apiGatewayArnParts[2] || '';
  const resourcePath = `/${apiGatewayArnParts.slice(3).join('/')}`.replace(/\/$/, '/') || '/';
  return { httpMethod, resourcePath };
};

const getHeader = (headers: Record<string, string | undefined> | null | undefined, name: string) => {
  if (!headers) {
    return null;
  }
  const key = Object.keys(headers).find((header) => header.toLowerCase() === name.toLowerCase());
  if (!key) {
    return null;
  }
  const value = headers[key];
  return value?.trim() || null;
};

const getBearerToken = (authorizationHeader?: string | null) => {
  if (!authorizationHeader) {
    return null;
  }
  const trimmed = authorizationHeader.trim();
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

const decodeTokenPayload = (token: string): JwtPayload => {
  const parts = token.split('.');
  if (parts.length < 2) {
    throw new Error('invalid_token');
  }
  const payload = Buffer.from(parts[1], 'base64').toString('utf8');
  const decoded = JSON.parse(payload);
  return decoded as JwtPayload;
};

const getVerifier = (userPoolId: string, clientId: string | undefined, tokenUse: string) => {
  const cacheKey = `${userPoolId}:${clientId || 'none'}:${tokenUse}`;
  const cached = verifierCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const verifier = CognitoJwtVerifier.create({
    userPoolId,
    tokenUse: tokenUse as 'id' | 'access',
    clientId: clientId ?? null
  }) as CognitoVerifier;
  verifierCache.set(cacheKey, verifier);
  return verifier;
};

const verifyJwt = async (token: string): Promise<JwtPayload> => {
  const userPoolId = process.env.COGNITO_USER_POOL_ID?.trim();
  if (!userPoolId) {
    throw new Error('missing_user_pool');
  }
  const clientId = process.env.COGNITO_CLIENT_ID?.trim();
  const decoded = decodeTokenPayload(token);
  const tokenUse = decoded.token_use;
  if (tokenUse !== 'id' && tokenUse !== 'access') {
    throw new Error('invalid_token_use');
  }
  const verifier = getVerifier(userPoolId, clientId, tokenUse);
  const payload = await verifier.verify(token, {
    clientId: clientId ?? null,
    tokenUse: tokenUse as 'id' | 'access'
  });
  return payload as JwtPayload;
};

const getTenantClaim = (payload: JwtPayload) => {
  const claimKey = process.env.TENANT_CLAIM_KEY?.trim() || 'custom:tenantId';
  const claimValue = payload[claimKey];
  if (typeof claimValue === 'string') {
    return claimValue;
  }
  if (claimKey !== 'tenantId' && typeof payload.tenantId === 'string') {
    return payload.tenantId;
  }
  return null;
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

export const handler = async (event: APIGatewayRequestAuthorizerEvent) => {
  const stage = process.env.STAGE || 'dev';
  const userPoolId = process.env.COGNITO_USER_POOL_ID?.trim();

  if (!userPoolId) {
    if (stage === 'prod') {
      throw new Error('Unauthorized');
    }
    return buildPolicy('dev-anon', 'Allow', event.methodArn, { mode: 'dev' });
  }

  const authRequired = requiresAuth(event.methodArn);
  const authorizationHeader = getHeader(event.headers, 'authorization');
  const token = getBearerToken(authorizationHeader);

  if (!authRequired && !token) {
    return buildPolicy('optional-auth', 'Allow', event.methodArn, { mode: 'optional' });
  }

  if (!token) {
    throw new Error('Unauthorized');
  }

  try {
    const payload = await verifyJwt(token);
    const tenantHeader = getHeader(event.headers, 'x-tenant-id');
    if (!tenantHeader) {
      throw new Error('missing_tenant');
    }
    const tenantClaim = getTenantClaim(payload);
    if (!tenantClaim || tenantClaim !== tenantHeader) {
      throw new Error('tenant_mismatch');
    }
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
    context.tenantId = tenantClaim;

    return buildPolicy(principalId, 'Allow', event.methodArn, context);
  } catch (error) {
    throw new Error('Unauthorized');
  }
};
