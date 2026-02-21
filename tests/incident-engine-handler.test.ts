export {};

const startEventProcessing = jest.fn();
const updateDedupState = jest.fn();
const updateSeverityState = jest.fn();
const getActiveIncident = jest.fn();
const createIncident = jest.fn();
const recordIncidentEvent = jest.fn();
const putOutboxEvent = jest.fn();
const getIncidentById = jest.fn();
const updateIncident = jest.fn();
const updateActivePointer = jest.fn();
const deleteActivePointer = jest.fn();
const completeEventProcessing = jest.fn();
const failEventProcessing = jest.fn();
const incrementTenantMetric = jest.fn();

jest.mock('uuid', () => ({ v4: () => 'inc-1' }));

jest.mock('@sentinel/config', () => ({
  getConfig: () => ({
    defaultEnv: 'dev',
    incidentsTableName: 'Incidents',
    eventStateTableName: 'EventState',
    incidentEventsTableName: 'IncidentEvents',
    outboxTableName: 'Outbox',
    metricsTableName: 'Metrics',
    rulesTableName: 'Rules',
    eventStateTtlSeconds: 60,
    incidentEventsTtlSeconds: 60,
    outboxTtlSeconds: 60,
    dedupWindowMs: 1000,
    severityWindowMs: 1000,
    processingTimeoutSeconds: 10
  }),
  loadRules: jest.fn()
}));

jest.mock('@sentinel/logger', () => ({
  createLogger: () => {
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      withContext: () => logger
    };
    return logger;
  }
}));

jest.mock('@sentinel/metrics', () => ({ emitMetrics: jest.fn() }));

jest.mock('@sentinel/dynamodb', () => ({
  buildIncidentKey: jest.fn(() => 'incident-key'),
  startEventProcessing,
  updateDedupState,
  updateSeverityState,
  getActiveIncident,
  createIncident,
  recordIncidentEvent,
  putOutboxEvent,
  getIncidentById,
  updateIncident,
  updateActivePointer,
  deleteActivePointer,
  completeEventProcessing,
  failEventProcessing,
  incrementTenantMetric
}));

const { loadRules } = require('@sentinel/config');
const { handler } = require('../services/incident-engine/src/handler');

const baseDetail = {
  eventId: 'evt-1',
  source: 'service',
  type: 'error',
  timestamp: '2024-01-01T00:00:00.000Z',
  fingerprint: 'fp',
  attributes: { env: 'prod' },
  tenantId: 'tenant-1'
};

const makeSqsEvent = (detailOverrides: Record<string, unknown> = {}) => ({
  Records: [
    {
      messageId: 'msg-1',
      body: JSON.stringify({ detail: { ...baseDetail, ...detailOverrides } })
    }
  ]
});

describe('incident engine handler', () => {
  beforeEach(() => {
    startEventProcessing.mockReset();
    updateDedupState.mockReset();
    updateSeverityState.mockReset();
    getActiveIncident.mockReset();
    createIncident.mockReset();
    recordIncidentEvent.mockReset();
    putOutboxEvent.mockReset();
    getIncidentById.mockReset();
    updateIncident.mockReset();
    updateActivePointer.mockReset();
    deleteActivePointer.mockReset();
    completeEventProcessing.mockReset();
    failEventProcessing.mockReset();
    incrementTenantMetric.mockReset();
    loadRules.mockReset();
  });

  it('opens a new incident when no active pointer exists', async () => {
    startEventProcessing.mockResolvedValueOnce({ status: 'new' });
    updateDedupState.mockResolvedValueOnce({
      count: 1,
      windowStart: Date.now(),
      lastSeen: new Date().toISOString(),
      suppressed: false
    });
    updateSeverityState.mockResolvedValueOnce({
      count: 1,
      windowStart: Date.now(),
      lastSeen: new Date().toISOString()
    });
    loadRules.mockResolvedValueOnce({
      rules: [{ severity: 'high', threshold: 1, windowMs: 1000 }]
    });
    getActiveIncident.mockResolvedValueOnce(undefined);
    createIncident.mockResolvedValueOnce(undefined);
    recordIncidentEvent.mockResolvedValueOnce(undefined);
    putOutboxEvent.mockResolvedValueOnce(undefined);
    completeEventProcessing.mockResolvedValueOnce(undefined);

    await handler(makeSqsEvent() as never, { awsRequestId: 'r1' } as never);

    expect(createIncident).toHaveBeenCalled();
    const incidentArg = createIncident.mock.calls[0][2];
    expect(incidentArg.severity).toBe('high');
    expect(putOutboxEvent).toHaveBeenCalled();
    const outboxDetail = putOutboxEvent.mock.calls[0][1].detail;
    expect(outboxDetail.changeType).toBe('OPENED');
    expect(completeEventProcessing).toHaveBeenCalled();
  });

  it('updates existing incident and emits escalation outbox event', async () => {
    startEventProcessing.mockResolvedValueOnce({ status: 'new' });
    updateDedupState.mockResolvedValueOnce({
      count: 2,
      windowStart: Date.now(),
      lastSeen: new Date().toISOString(),
      suppressed: false
    });
    updateSeverityState.mockResolvedValueOnce({
      count: 5,
      windowStart: Date.now(),
      lastSeen: new Date().toISOString()
    });
    loadRules.mockResolvedValueOnce({
      rules: [{ severity: 'critical', threshold: 1, windowMs: 1000 }]
    });
    getActiveIncident.mockResolvedValueOnce({ incidentId: 'inc-2', status: 'OPEN', updatedAt: '2024-01-01T00:00:00.000Z' });
    getIncidentById.mockResolvedValueOnce({
      incidentId: 'inc-2',
      tenantId: 'tenant-1',
      status: 'OPEN',
      source: 'service',
      fingerprint: 'fp',
      env: 'prod',
      severity: 'low',
      openedAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      lastEventAt: '2024-01-01T00:00:00.000Z',
      eventCount: 1,
      version: 1
    });
    updateIncident.mockResolvedValueOnce(undefined);
    updateActivePointer.mockResolvedValueOnce(undefined);
    recordIncidentEvent.mockResolvedValueOnce(undefined);
    putOutboxEvent.mockResolvedValueOnce(undefined);
    completeEventProcessing.mockResolvedValueOnce(undefined);

    await handler(makeSqsEvent() as never, { awsRequestId: 'r1' } as never);

    expect(updateIncident).toHaveBeenCalled();
    const updateArgs = updateIncident.mock.calls[0][3];
    expect(updateArgs.severity).toBe('critical');
    const outboxDetail = putOutboxEvent.mock.calls[0][1].detail;
    expect(outboxDetail.changeType).toBe('ESCALATED');
    expect(updateActivePointer).toHaveBeenCalled();
  });

  it('deletes pointer when incident missing and recreates', async () => {
    startEventProcessing.mockResolvedValueOnce({ status: 'new' });
    updateDedupState.mockResolvedValueOnce({
      count: 1,
      windowStart: Date.now(),
      lastSeen: new Date().toISOString(),
      suppressed: false
    });
    updateSeverityState.mockResolvedValueOnce({
      count: 1,
      windowStart: Date.now(),
      lastSeen: new Date().toISOString()
    });
    loadRules.mockResolvedValueOnce({
      rules: [{ severity: 'medium', threshold: 1, windowMs: 1000 }]
    });
    getActiveIncident.mockResolvedValueOnce({ incidentId: 'missing', status: 'OPEN', updatedAt: '2024-01-01T00:00:00.000Z' });
    getIncidentById.mockResolvedValueOnce(undefined);
    deleteActivePointer.mockResolvedValueOnce(undefined);
    createIncident.mockResolvedValueOnce(undefined);
    recordIncidentEvent.mockResolvedValueOnce(undefined);
    putOutboxEvent.mockResolvedValueOnce(undefined);
    completeEventProcessing.mockResolvedValueOnce(undefined);

    await handler(makeSqsEvent() as never, { awsRequestId: 'r1' } as never);

    expect(deleteActivePointer).toHaveBeenCalled();
    expect(createIncident).toHaveBeenCalled();
  });
});
