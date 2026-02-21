export {};

const send = jest.fn();
const complete = jest.fn();
const failStore = jest.fn();
const start = jest.fn();

jest.mock('@sentinel/aws', () => ({
  getEventBridgeClient: () => ({ send })
}));

const config = {
  eventBusName: 'bus',
  defaultEnv: 'dev',
  idempotencyTableName: 'Idempotency',
  idempotencyTtlSeconds: 60,
  ingestAuthRequired: false,
  metricsTableName: 'Metrics'
};

jest.mock('@sentinel/config', () => ({
  getConfig: () => config
}));

jest.mock('@sentinel/logger', () => ({
  createLogger: () => ({
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    withContext: function () {
      return this;
    }
  })
}));

jest.mock('@sentinel/metrics', () => ({
  emitMetrics: jest.fn()
}));

jest.mock('@sentinel/schemas', () => ({
  validateIngestEvent: jest.fn()
}));

jest.mock('@sentinel/idempotency', () => ({
  buildIdempotencyKey: (_tenantId: string, eventId: string) => `TENANT#t#EVENT#${eventId}`,
  createIdempotencyStore: () => ({ start, complete, fail: failStore })
}));

jest.mock('@sentinel/dynamodb', () => ({
  incrementTenantMetric: jest.fn()
}));

const { validateIngestEvent } = require('@sentinel/schemas');
const { incrementTenantMetric } = require('@sentinel/dynamodb');
const { handler } = require('../services/ingest-api/src/handler');

const baseEvent = {
  eventId: 'evt-1',
  source: 'service',
  type: 'error',
  timestamp: '2024-01-01T00:00:00.000Z',
  fingerprint: 'fp',
  attributes: {}
};

const makeApiEvent = (overrides: Partial<any> = {}) => ({
  httpMethod: 'POST',
  path: '/v1/events',
  headers: { 'X-Tenant-Id': 'tenant-1', ...overrides.headers },
  body: Object.prototype.hasOwnProperty.call(overrides, 'body')
    ? overrides.body
    : JSON.stringify(baseEvent),
  isBase64Encoded: false
});

describe('ingest api handler', () => {
  beforeEach(() => {
    send.mockReset();
    start.mockReset();
    complete.mockReset();
    failStore.mockReset();
    validateIngestEvent.mockReset();
    config.ingestAuthRequired = false;
  });

  it('rejects missing tenant', async () => {
    const response = await handler(
      { ...makeApiEvent(), headers: {} } as never,
      { awsRequestId: 'r1' } as never
    );
    expect(response.statusCode).toBe(400);
  });

  it('rejects missing auth when required', async () => {
    config.ingestAuthRequired = true;
    const response = await handler(
      makeApiEvent({ headers: { 'X-Tenant-Id': 'tenant-1' } }) as never,
      { awsRequestId: 'r1' } as never
    );
    expect(response.statusCode).toBe(401);
  });

  it('rejects missing body', async () => {
    const response = await handler(
      makeApiEvent({ body: null }) as never,
      { awsRequestId: 'r1' } as never
    );
    expect(response.statusCode).toBe(400);
  });

  it('rejects invalid json', async () => {
    const response = await handler(
      makeApiEvent({ body: 'not-json' }) as never,
      { awsRequestId: 'r1' } as never
    );
    expect(response.statusCode).toBe(400);
  });

  it('rejects invalid event', async () => {
    validateIngestEvent.mockReturnValue({ valid: false, errors: ['bad'] });
    const response = await handler(
      makeApiEvent() as never,
      { awsRequestId: 'r1' } as never
    );
    expect(response.statusCode).toBe(400);
  });

  it('returns duplicate on idempotent replay', async () => {
    validateIngestEvent.mockReturnValue({ valid: true, value: baseEvent });
    start.mockResolvedValueOnce({ started: false, record: { status: 'COMPLETED', response: { accepted: true } } });
    const response = await handler(
      makeApiEvent() as never,
      { awsRequestId: 'r1' } as never
    );
    const payload = JSON.parse(response.body);
    expect(payload.duplicate).toBe(true);
  });

  it('fails when eventbridge returns failed entry', async () => {
    validateIngestEvent.mockReturnValue({ valid: true, value: baseEvent });
    start.mockResolvedValueOnce({ started: true });
    send.mockResolvedValueOnce({ FailedEntryCount: 1 });
    const response = await handler(
      makeApiEvent() as never,
      { awsRequestId: 'r1' } as never
    );
    expect(response.statusCode).toBe(500);
    expect(failStore).toHaveBeenCalled();
  });

  it('publishes to eventbridge on success', async () => {
    validateIngestEvent.mockReturnValue({ valid: true, value: baseEvent });
    start.mockResolvedValueOnce({ started: true });
    send.mockResolvedValueOnce({ FailedEntryCount: 0 });
    const response = await handler(
      makeApiEvent() as never,
      { awsRequestId: 'r1' } as never
    );
    const payload = JSON.parse(response.body);
    expect(payload.accepted).toBe(true);
    expect(complete).toHaveBeenCalled();
  });

  it('includes tenant context and defaults in published detail', async () => {
    validateIngestEvent.mockReturnValue({ valid: true, value: { ...baseEvent, attributes: {} } });
    start.mockResolvedValueOnce({ started: true });
    send.mockResolvedValueOnce({ FailedEntryCount: 0 });

    const response = await handler(
      makeApiEvent({ headers: { 'X-Tenant-Id': 'tenant-1', 'X-Correlation-Id': 'corr-1' } }) as never,
      { awsRequestId: 'r1' } as never
    );

    expect(response.statusCode).toBe(200);
    const command = send.mock.calls[0][0];
    expect(command.input.Entries[0].EventBusName).toBe('bus');
    expect(command.input.Entries[0].Source).toBe('sentinel.ingest');
    expect(command.input.Entries[0].DetailType).toBe(baseEvent.type);

    const detail = JSON.parse(command.input.Entries[0].Detail);
    expect(detail.tenantId).toBe('tenant-1');
    expect(detail.env).toBe('dev');
    expect(detail.correlationId).toBe('corr-1');
    expect(detail.receivedAt).toBeDefined();
    expect(incrementTenantMetric).toHaveBeenCalledWith('Metrics', 'tenant-1', 'ingested_total', 1);
  });
});
