import { v4 as uuidv4 } from 'uuid';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:3000';
const authToken = process.env.AUTH_TOKEN;

const headers: Record<string, string> = {
  'content-type': 'application/json'
};

if (authToken) {
  headers.authorization = `Bearer ${authToken}`;
}

const postEvent = async (payload: Record<string, unknown>) => {
  const response = await fetch(`${apiBaseUrl}/v1/events`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  return { status: response.status, data };
};

const listIncidents = async (source: string) => {
  const response = await fetch(`${apiBaseUrl}/v1/incidents?status=OPEN&source=${encodeURIComponent(source)}`, {
    headers
  });
  const data = await response.json();
  return { status: response.status, data };
};

const run = async () => {
  const source = process.env.SOURCE || 'service-a';
  const env = process.env.ENV || 'dev';
  const fingerprint = 'HTTP_500_/checkout';

  const baseEvent = {
    source,
    type: 'error_spike',
    severityHint: 'medium',
    timestamp: new Date().toISOString(),
    fingerprint,
    attributes: {
      env,
      region: 'us-east-1',
      errorCode: 'HTTP_500'
    }
  };

  console.log('Sending initial event...');
  const first = await postEvent({ ...baseEvent, eventId: uuidv4() });
  console.log(first);

  console.log('Sending duplicate events to trigger dedup...');
  for (let i = 0; i < 3; i += 1) {
    const response = await postEvent({ ...baseEvent, eventId: uuidv4(), timestamp: new Date().toISOString() });
    console.log(response);
    await sleep(300);
  }

  console.log('Sending additional events to escalate severity...');
  for (let i = 0; i < 8; i += 1) {
    const response = await postEvent({
      ...baseEvent,
      eventId: uuidv4(),
      timestamp: new Date().toISOString(),
      severityHint: i > 3 ? 'high' : 'medium'
    });
    console.log(response);
    await sleep(200);
  }

  console.log('Querying open incidents...');
  const incidents = await listIncidents(source);
  console.log(JSON.stringify(incidents, null, 2));
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
