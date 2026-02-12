/**
 * WebSocket Authorizer Lambda
 *
 * Validates JWT tokens from WebSocket $connect query string.
 * Uses Cognito ID tokens verified via aws-jwt-verify.
 *
 * During migration, allows anonymous connections when no token is provided.
 * Set ALLOW_ANONYMOUS=false to require authentication.
 */

import { CognitoJwtVerifier } from 'aws-jwt-verify';

const USER_POOL_ID = process.env.USER_POOL_ID!;
const CLIENT_ID = process.env.CLIENT_ID!;
const ALLOW_ANONYMOUS = process.env.ALLOW_ANONYMOUS !== 'false';

// Verifier caches JWKS between invocations (Lambda container reuse)
const verifier = CognitoJwtVerifier.create({
  userPoolId: USER_POOL_ID,
  tokenUse: 'id',
  clientId: CLIENT_ID,
});

interface AuthorizerEvent {
  type: string;
  methodArn: string;
  queryStringParameters?: Record<string, string>;
  headers?: Record<string, string>;
}

interface AuthorizerResponse {
  principalId: string;
  policyDocument: {
    Version: string;
    Statement: Array<{
      Action: string;
      Effect: string;
      Resource: string;
    }>;
  };
  context?: Record<string, string>;
}

export const handler = async (event: AuthorizerEvent): Promise<AuthorizerResponse> => {
  console.log('WebSocket authorizer invoked');

  const token = event.queryStringParameters?.token;

  if (!token) {
    if (ALLOW_ANONYMOUS) {
      console.log('No token provided, allowing anonymous connection');
      return generatePolicy('anonymous', 'Allow', event.methodArn, {
        userId: 'anonymous',
        orgId: 'default',
      });
    }
    console.log('No token provided, denying connection');
    return generatePolicy('anonymous', 'Deny', event.methodArn);
  }

  try {
    const payload = await verifier.verify(token);
    console.log(`Token verified for user: ${payload.sub}`);

    return generatePolicy(payload.sub as string, 'Allow', event.methodArn, {
      userId: payload.sub as string,
      orgId: (payload['custom:orgId'] as string) || 'default',
      email: (payload.email as string) || '',
    });
  } catch (error) {
    console.error('Token verification failed:', error);
    return generatePolicy('user', 'Deny', event.methodArn);
  }
};

function generatePolicy(
  principalId: string,
  effect: string,
  resource: string,
  context?: Record<string, string>,
): AuthorizerResponse {
  const response: AuthorizerResponse = {
    principalId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'execute-api:Invoke',
          Effect: effect,
          Resource: resource,
        },
      ],
    },
  };

  if (context) {
    response.context = context;
  }

  return response;
}
