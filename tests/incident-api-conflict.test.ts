import { handler } from '../services/incident-api/src/handler';
import { Incident } from '@sentinel/domain';
import {
  deleteActivePointer,
  getIncidentById,
  putOutboxEvent,
  updateActivePointer,
  updateIncident
} from '@sentinel/dynamodb';

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
  putOutboxEvent: jest.fn(),
  updateActivePointer: jest.fn(),
  updateIncident: jest.fn()
}));

describe('incident-api conflict handling', () => {
  beforeEach(() => {
    (deleteActivePointer as jest.Mock).mockReset();
    (getIncidentById as jest.Mock).mockReset();
    (putOutboxEvent as jest.Mock).mockReset();
    (updateActivePointer as jest.Mock).mockReset();
    (updateIncident as jest.Mock).mockReset();
  });

  it('returns 409 on conditional update conflict', async () => {
    const incident: Incident = {
      incidentId: 'inc-1',
      tenantId: 'tenant-1',
      status: 'OPEN',
      source: 'service-a',
      fingerprint: 'HTTP_500_/checkout',
      env: 'prod',
      severity: 'medium',
      openedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastEventAt: new Date().toISOString(),
      eventCount: 3,
      version: 1
    };

    (getIncidentById as jest.Mock).mockResolvedValue(incident);
    const conflictError = Object.assign(new Error('conflict'), {
      name: 'ConditionalCheckFailedException'
    });
    (updateIncident as jest.Mock).mockRejectedValue(conflictError);

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

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body).error).toBe('conflict');
    expect(updateActivePointer).not.toHaveBeenCalled();
    expect(deleteActivePointer).not.toHaveBeenCalled();
    expect(putOutboxEvent).not.toHaveBeenCalled();
  });
});
