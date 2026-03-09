export {};

import { analyzeWithProvider, normalizeOutput } from '@sentinel/ai';
import { Incident } from '@sentinel/domain';

describe('ai provider helpers', () => {
  it('normalizes empty output with defaults', () => {
    const output = normalizeOutput({}, 'model-x', 'mock');
    expect(output.aiSummary).toBe('No summary available.');
    expect(output.aiSuggestedActions.length).toBeGreaterThan(0);
    expect(output.aiConfidence).toBeGreaterThanOrEqual(0);
  });

  it('analyzeWithProvider passes prompt and clamps confidence', async () => {
    const incident: Incident = {
      incidentId: 'inc-1',
      tenantId: 'tenant-1',
      status: 'OPEN',
      source: 'svc',
      fingerprint: 'fp',
      env: 'prod',
      severity: 'low',
      openedAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      lastEventAt: '2024-01-01T00:00:00.000Z',
      eventCount: 1,
      version: 1
    };

    const provider = {
      name: 'test',
      analyzeIncident: jest.fn().mockResolvedValue({
        aiSummary: 'ok',
        aiSeverityRecommendation: 'high',
        aiSuggestedActions: ['do thing'],
        aiConfidence: 2
      })
    };

    const result = await analyzeWithProvider(
      provider,
      { incident, recentEvents: [], eventCount: 1 },
      {
        aiProvider: 'test',
        aiModel: 'model-x',
        aiTimeoutMs: 1000,
        aiMaxRetries: 0
      }
    );

    expect(provider.analyzeIncident).toHaveBeenCalled();
    const arg = provider.analyzeIncident.mock.calls[0][0];
    expect(arg.prompt).toContain('Incident context');
    expect(result.aiConfidence).toBe(1);
  });
});
