const baseUrl = process.env.INTEGRATION_BASE_URL;
const token = process.env.INTEGRATION_AUTH_TOKEN;

describe('incident api integration (stub)', () => {
  if (!baseUrl) {
    test.skip('INTEGRATION_BASE_URL not set', () => undefined);
    return;
  }

  it('lists open incidents', async () => {
    const headers: Record<string, string> = {};
    if (token) {
      headers.authorization = `Bearer ${token}`;
    }

    const response = await fetch(`${baseUrl}/v1/incidents?status=OPEN`, { headers });
    expect(response.status).toBeLessThan(500);
  });
});
