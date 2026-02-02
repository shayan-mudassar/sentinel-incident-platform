# Sentinel Setup Guide

This guide covers backend deployment, frontend setup, and local development.

## Quick start (production)

```bash
npm install
sam build -t infra/template.yaml
sam deploy --guided -t infra/template.yaml --parameter-overrides \
Stage=prod \
CorsAllowOrigin=https://your-ui-domain \
CognitoUserPoolId=<user-pool-id> \
SlackWorkspaceId=<slack-workspace-id> \
SlackChannelId=<slack-channel-id> \
AlarmEmail=<optional-email>
```

Use the `ApiUrl` output in the web UI.

## Prerequisites

- Node.js 20+
- npm
- AWS CLI configured (`aws configure` or AWS SSO)
- AWS SAM CLI
- Docker (only needed for local `sam local`)

## AWS setup

### 1) Configure AWS CLI

```bash
aws configure
```

Set the default region where you plan to deploy.

### 2) IAM permissions

The deploy user or role should have access to:

- CloudFormation
- Lambda
- API Gateway
- DynamoDB
- SQS
- EventBridge
- CloudWatch (logs + alarms)
- SNS
- WAFv2
- IAM (for AWS Chatbot role)
- AWS Chatbot (optional, for Slack alerts)

### 3) Cognito user pool

This template requires a Cognito user pool for incident endpoints. You can create one in the AWS
Console or with the CLI. Minimum steps:

1. Create a user pool.
2. Create an app client (no secret is simplest for testing).
3. Create a user and set a password.
4. Get a JWT token for the UI.

Example: get a token via CLI (adjust to your setup):

```bash
aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id <app-client-id> \
  --auth-parameters USERNAME=<username>,PASSWORD=<password>
```

Use the `IdToken` as the UI token.

### 4) Slack alerts (optional)

To enable Slack alerts:

1. Open AWS Chatbot in the console and authorize your Slack workspace.
2. Note the Slack workspace ID and channel ID.
3. Pass both as parameters during `sam deploy`.

## Backend (AWS)

Install dependencies:

```bash
npm install
```

### Deploy to AWS (production)

```bash
sam build -t infra/template.yaml
sam deploy --guided -t infra/template.yaml --parameter-overrides \
Stage=prod \
CorsAllowOrigin=https://your-ui-domain \
CognitoUserPoolId=<user-pool-id> \
SlackWorkspaceId=<slack-workspace-id> \
SlackChannelId=<slack-channel-id> \
AlarmEmail=<optional-email>
```

After deployment, note the `ApiUrl` output. You will use it in the UI.

Note: the template includes a placeholder `CognitoUserPoolId` for CI validation. You must
override it with a real user pool id during deployment or CloudFormation will fail validation.

### Verify the API

Public ingest endpoint:

```bash
curl -s -X POST "<ApiUrl>/v1/events" \
  -H "content-type: application/json" \
  -d '{"eventId":"1","source":"service-a","type":"error_spike","timestamp":"2024-01-01T00:00:00Z","fingerprint":"HTTP_500_/checkout","attributes":{"env":"prod"}}'
```

Incident endpoints require a JWT from Cognito.

### Local API (optional)

Local API can run with SAM, but the Lambdas still use real AWS services (EventBridge, DynamoDB,
SQS). You will need AWS credentials and a deployed stack for full end-to-end behavior.

```bash
sam build -t infra/template.yaml
sam local start-api -t infra/template.yaml --parameter-overrides CognitoUserPoolId=<user-pool-id>
```

### Demo script

```bash
API_BASE_URL=http://localhost:3000 npm run demo
```

### Load test (optional)

```bash
LOAD_TEST_URL=https://<api-id>.execute-api.<region>.amazonaws.com/prod/v1/incidents?status=OPEN \
LOAD_TEST_AUTH_TOKEN=<jwt> \
npm run load-test
```

## Frontend (Web UI)

### Run locally

```bash
VITE_API_BASE_URL=http://localhost:3000 \
VITE_AUTH_TOKEN=<jwt> \
npm run web:dev
```

Open the browser at the URL shown by Vite.

### Build for production

```bash
npm run web:build
```

Build output is in `web/dist`.

## Deploy UI to S3 + CloudFront

1) Create an S3 bucket and enable static hosting:

```bash
aws s3 mb s3://<your-ui-bucket>
aws s3 website s3://<your-ui-bucket> --index-document index.html --error-document index.html
```

2) Upload the UI build:

```bash
aws s3 sync web/dist s3://<your-ui-bucket>
```

3) Create a CloudFront distribution with the S3 bucket as origin.

4) Update API CORS for the UI domain:

```bash
sam deploy --guided -t infra/template.yaml --parameter-overrides \
CorsAllowOrigin=https://<your-cloudfront-domain> \
CognitoUserPoolId=<user-pool-id>
```

## Using the UI

- In the Connection panel, set **API Base URL** to the backend `ApiUrl`.
- Paste a **JWT token** to access incidents (ACK/RESOLVE and list).
- Use **Ingest Event** to send test events.

## Tests and Validation

```bash
npm test
npm run typecheck
npm run web:test
sam validate --region us-east-1 -t infra/template.yaml
npm run build
```

## Troubleshooting

- 401/403 on incident endpoints: check JWT token and Cognito user pool.
- CORS errors: set `CorsAllowOrigin` to your UI domain and redeploy.
- Slack alerts missing: verify AWS Chatbot workspace/channel IDs and SNS topic permissions.

## Notes

- Do not commit credentials. Use AWS profiles, environment variables, or CI secrets.
- If you create `samconfig.toml`, keep it out of Git by adding it to `.gitignore`.
- Slack alerts require AWS Chatbot permissions and the Slack workspace/channel IDs.
