import { handler } from '../services/incident-api/src/handler';
import {
  deleteActivePointer,
  getIncidentById,
  putOutboxEvent,
  updateActivePointer,
  updateIncident
} from '@sentinel/dynamodb';
import { Incident } from '@sentinel/domain';

jest.mock('@sentinel/config', () => ({
  getConfig: () => ({
    incidentsTableName: 'Incidents',
    outboxTableName: 'Outbox',
    outboxTtlSeconds: 60,
    incidentEventsTableName: 'IncidentEvents',
    metricsTableName: 'Metrics',
    authRequired: false
  })
}));

jest.mock('@sentinel/dynamodb', () => ({
  deleteActivePointer: jest.fn(),
  getIncidentById: jest.fn(),
  listIncidents: jest.fn(),
  listIncidentEvents: jest.fn(),
  putOutboxEvent: jest.fn(),
  updateActivePointer: jest.fn(),
  updateIncident: jest.fn(),
  getTenantMetrics: jest.fn()
}));

describe('incident-api idempotency', () => {
  beforeEach(() => {
    (deleteActivePointer as jest.Mock).mockReset();
    (getIncidentById as jest.Mock).mockReset();
    (putOutboxEvent as jest.Mock).mockReset();
    (updateActivePointer as jest.Mock).mockReset();
    (updateIncident as jest.Mock).mockReset();
  });

  it('ack is idempotent when already acked', async () => {
    const incident: Incident = {
      incidentId: 'inc-1',
      tenantId: 'tenant-1',
      status: 'ACKED',
      source: 'service-a',
      fingerprint: 'HTTP_500_/checkout',
      env: 'prod',
      severity: 'medium',
      openedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastEventAt: new Date().toISOString(),
      eventCount: 3,
      version: 2
    };

    (getIncidentById as jest.Mock).mockResolvedValue(incident);

    const response = await handler(
      {
        httpMethod: 'POST',
        path: '/v1/incidents/inc-1/ack',
        headers: { 'X-Tenant-Id': 'tenant-1' },
        body: null,
        isBase64Encoded: false
      } as never,
      { awsRequestId: 'req-1' } as never
    );

    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.body);
    expect(payload.idempotent).toBe(true);
    expect(updateIncident).not.toHaveBeenCalled();
  });

  it('resolve is idempotent when already resolved', async () => {
    const incident: Incident = {
      incidentId: 'inc-2',
      tenantId: 'tenant-1',
      status: 'RESOLVED',
      source: 'service-a',
      fingerprint: 'HTTP_500_/checkout',
      env: 'prod',
      severity: 'medium',
      openedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastEventAt: new Date().toISOString(),
      eventCount: 3,
      version: 2
    };

    (getIncidentById as jest.Mock).mockResolvedValue(incident);

    const response = await handler(
      {
        httpMethod: 'POST',
        path: '/v1/incidents/inc-2/resolve',
        headers: { 'X-Tenant-Id': 'tenant-1' },
        body: null,
        isBase64Encoded: false
      } as never,
      { awsRequestId: 'req-2' } as never
    );

    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.body);
    expect(payload.idempotent).toBe(true);
    expect(updateIncident).not.toHaveBeenCalled();
  });

  it('ack fails when incident is resolved', async () => {
    const incident: Incident = {
      incidentId: 'inc-3',
      tenantId: 'tenant-1',
      status: 'RESOLVED',
      source: 'service-a',
      fingerprint: 'HTTP_500_/checkout',
      env: 'prod',
      severity: 'medium',
      openedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastEventAt: new Date().toISOString(),
      eventCount: 3,
      version: 2
    };

    (getIncidentById as jest.Mock).mockResolvedValue(incident);

    const response = await handler(
      {
        httpMethod: 'POST',
        path: '/v1/incidents/inc-3/ack',
        headers: { 'X-Tenant-Id': 'tenant-1' },
        body: null,
        isBase64Encoded: false
      } as never,
      { awsRequestId: 'req-3' } as never
    );

    expect(response.statusCode).toBe(409);
    const payload = JSON.parse(response.body);
    expect(payload.error.code).toBe('invalid_state');
    expect(updateIncident).not.toHaveBeenCalled();
  });
});
