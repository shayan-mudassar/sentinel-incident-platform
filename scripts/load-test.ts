import autocannon, { Result } from 'autocannon';

const url = process.env.LOAD_TEST_URL || 'http://localhost:3000/v1/incidents?status=OPEN';
const duration = Number(process.env.LOAD_TEST_DURATION || 30);
const connections = Number(process.env.LOAD_TEST_CONNECTIONS || 10);
const token = process.env.LOAD_TEST_AUTH_TOKEN;

const headers: Record<string, string> = {};
if (token) {
  headers.authorization = `Bearer ${token}`;
}

const instance = autocannon(
  {
    url,
    connections,
    duration,
    headers
  },
  (error: Error | null, result: Result) => {
    if (error) {
      console.error(error);
      process.exit(1);
    }
    console.log('Load test complete:', {
      requestsPerSecond: result.requests.average,
      latencyMs: result.latency.average,
      throughputBytes: result.throughput.average
    });
  }
);

autocannon.track(instance, { renderProgressBar: true });
