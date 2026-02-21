import { handler } from '../services/ingest-api/src/handler';
import { createIdempotencyStore } from '@sentinel/idempotency';
import { validateIngestEvent } from '@sentinel/schemas';

jest.mock('@sentinel/config', () => ({
  getConfig: () => ({
    eventBusName: 'bus',
    idempotencyTableName: 'Idempotency',
    idempotencyTtlSeconds: 60,
    defaultEnv: 'dev',
    metricsTableName: 'Metrics',
    ingestAuthRequired: false
  })
}));

jest.mock('@sentinel/idempotency', () => ({
  buildIdempotencyKey: (tenantId: string, eventId: string) => `TENANT#${tenantId}#EVENT#${eventId}`,
  createIdempotencyStore: jest.fn()
}));

jest.mock('@sentinel/schemas', () => ({
  validateIngestEvent: jest.fn()
}));

jest.mock('@sentinel/metrics', () => ({
  emitMetrics: jest.fn()
}));

jest.mock('@sentinel/dynamodb', () => ({
  incrementTenantMetric: jest.fn()
}));

describe('ingest idempotency', () => {
  beforeEach(() => {
    (createIdempotencyStore as jest.Mock).mockReset();
    (validateIngestEvent as jest.Mock).mockReset();
  });

  it('returns duplicate when idempotency record exists', async () => {
    (validateIngestEvent as jest.Mock).mockReturnValue({
      valid: true,
      value: {
        eventId: 'evt-1',
        source: 'service-a',
        type: 'error',
        timestamp: new Date().toISOString(),
        fingerprint: 'fp',
        attributes: {}
      }
    });

    const start = jest.fn().mockResolvedValue({
      started: false,
      record: {
        status: 'COMPLETED',
        response: { accepted: true, eventId: 'evt-1', status: 'published' }
      }
    });

    (createIdempotencyStore as jest.Mock).mockReturnValue({
      start,
      complete: jest.fn(),
      fail: jest.fn()
    });

    const response = await handler(
      {
        httpMethod: 'POST',
        path: '/v1/events',
        headers: { 'X-Tenant-Id': 'tenant-1' },
        body: JSON.stringify({
          eventId: 'evt-1',
          source: 'service-a',
          type: 'error',
          timestamp: new Date().toISOString(),
          fingerprint: 'fp',
          attributes: {}
        }),
        isBase64Encoded: false
      } as never,
      { awsRequestId: 'req-1' } as never
    );

    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.body);
    expect(payload.duplicate).toBe(true);
    expect(payload.eventId).toBe('evt-1');
  });
});
