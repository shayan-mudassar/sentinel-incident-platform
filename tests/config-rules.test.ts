export {};

const send = jest.fn();

jest.mock('@sentinel/aws', () => ({
  getDynamoDbDocClient: () => ({ send })
}));

describe('config and rules', () => {
  beforeEach(() => {
    jest.resetModules();
    send.mockReset();
    delete process.env.DEDUP_WINDOW_MS;
    delete process.env.INGEST_AUTH_REQUIRED;
    delete process.env.AUTH_REQUIRED;
  });

  it('getConfig applies defaults and parses numbers', () => {
    process.env.DEDUP_WINDOW_MS = 'not-a-number';
    const { getConfig } = require('../libs/config/src');
    const config = getConfig();
    expect(config.dedupWindowMs).toBe(5 * 60 * 1000);
    expect(config.authRequired).toBe(false);
    expect(config.ingestAuthRequired).toBe(false);
  });

  it('getConfig honors boolean flags', () => {
    process.env.AUTH_REQUIRED = 'true';
    process.env.INGEST_AUTH_REQUIRED = 'true';
    const { getConfig } = require('../libs/config/src');
    const config = getConfig();
    expect(config.authRequired).toBe(true);
    expect(config.ingestAuthRequired).toBe(true);
  });

  it('loadRules returns tenant-specific rules when present', async () => {
    const { loadRules } = require('../libs/config/src');
    send.mockResolvedValueOnce({
      Item: {
        rules: [{ severity: 'high', threshold: 1, windowMs: 1000 }],
        dedupWindowMs: 1234,
        severityWindowMs: 4321
      }
    });

    const rules = await loadRules('Rules', 'tenant-1');
    expect(rules.rules[0].severity).toBe('high');
    expect(rules.dedupWindowMs).toBe(1234);
  });

  it('loadRules falls back to default item then defaults', async () => {
    const { loadRules, defaultRules } = require('../libs/config/src');
    send
      .mockResolvedValueOnce({ Item: undefined })
      .mockResolvedValueOnce({
        Item: {
          rules: [{ severity: 'medium', threshold: 2, windowMs: 2000 }]
        }
      });

    const rules = await loadRules('Rules', 'tenant-1');
    expect(rules.rules[0].threshold).toBe(2);
    expect(rules.rules[0].severity).toBe('medium');

    send.mockRejectedValueOnce(new Error('boom'));
    const fallback = await loadRules('Rules', 'tenant-1');
    expect(fallback.rules).toEqual(defaultRules.rules);
  });
});
