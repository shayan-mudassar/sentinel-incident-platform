export {};

const getIncidentById = jest.fn();
const listIncidentEvents = jest.fn();
const updateIncidentAiStatus = jest.fn();
const updateIncidentAiResult = jest.fn();
const analyzeWithProvider = jest.fn();
const createAiProvider = jest.fn(() => ({ name: 'mock', analyzeIncident: jest.fn() }));

jest.mock('@sentinel/config', () => ({
  getConfig: () => ({
    incidentsTableName: 'Incidents',
    incidentEventsTableName: 'IncidentEvents',
    aiEnabled: true,
    aiProvider: 'mock',
    aiModel: 'mock-model',
    aiTimeoutMs: 1000,
    aiMaxRetries: 0,
    aiMinEventCountForAnalysis: 1,
    aiReanalyzeOnIncidentUpdate: false
  })
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
  getIncidentById,
  listIncidentEvents,
  updateIncidentAiStatus,
  updateIncidentAiResult
}));

jest.mock('@sentinel/ai', () => ({
  analyzeWithProvider,
  createAiProvider
}));

const { handler } = require('../services/ai-analysis/src/handler');

const makeEvent = (detail: Record<string, unknown>) => ({
  Records: [
    {
      messageId: 'msg-1',
      body: JSON.stringify({ detail })
    }
  ]
});

describe('ai analysis handler', () => {
  beforeEach(() => {
    getIncidentById.mockReset();
    listIncidentEvents.mockReset();
    updateIncidentAiStatus.mockReset();
    updateIncidentAiResult.mockReset();
    analyzeWithProvider.mockReset();
    createAiProvider.mockClear();
  });

  it('stores ai results on success', async () => {
    getIncidentById.mockResolvedValueOnce({
      incidentId: 'inc-1',
      tenantId: 'tenant-1',
      status: 'OPEN',
      source: 'svc',
      fingerprint: 'fp',
      env: 'prod',
      severity: 'high',
      openedAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      lastEventAt: '2024-01-01T00:00:00.000Z',
      eventCount: 2,
      version: 1
    });
    listIncidentEvents.mockResolvedValueOnce({ items: [] });
    analyzeWithProvider.mockResolvedValueOnce({
      aiSummary: 'summary',
      aiSeverityRecommendation: 'high',
      aiSuggestedActions: ['act'],
      aiConfidence: 0.7,
      aiModel: 'mock-model',
      aiProvider: 'mock'
    });

    const response = await handler(
      makeEvent({ tenantId: 'tenant-1', incidentId: 'inc-1', changeType: 'OPENED' }) as never,
      { awsRequestId: 'r1' } as never
    );

    expect(updateIncidentAiStatus).toHaveBeenCalledWith(
      'Incidents',
      'tenant-1',
      'inc-1',
      1,
      'pending',
      expect.any(Object)
    );
    expect(updateIncidentAiResult).toHaveBeenCalled();
    expect(response.batchItemFailures).toHaveLength(0);
  });

  it('marks ai failure when provider throws', async () => {
    getIncidentById.mockResolvedValueOnce({
      incidentId: 'inc-1',
      tenantId: 'tenant-1',
      status: 'OPEN',
      source: 'svc',
      fingerprint: 'fp',
      env: 'prod',
      severity: 'high',
      openedAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      lastEventAt: '2024-01-01T00:00:00.000Z',
      eventCount: 2,
      version: 1
    });
    listIncidentEvents.mockResolvedValueOnce({ items: [] });
    analyzeWithProvider.mockRejectedValueOnce(new Error('boom'));

    const response = await handler(
      makeEvent({ tenantId: 'tenant-1', incidentId: 'inc-1', changeType: 'OPENED' }) as never,
      { awsRequestId: 'r1' } as never
    );

    expect(updateIncidentAiStatus).toHaveBeenCalledWith(
      'Incidents',
      'tenant-1',
      'inc-1',
      1,
      'failed',
      expect.objectContaining({ aiError: expect.stringContaining('boom') })
    );
    expect(response.batchItemFailures).toHaveLength(1);
  });
});
