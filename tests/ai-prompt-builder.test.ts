export {};

import { buildIncidentPrompt } from '@sentinel/ai';
import { Incident } from '@sentinel/domain';

describe('ai prompt builder', () => {
  it('includes key incident context and recent events', () => {
    const incident: Incident = {
      incidentId: 'inc-1',
      tenantId: 'tenant-1',
      status: 'OPEN',
      source: 'checkout-service',
      fingerprint: 'HTTP_500_/checkout',
      env: 'prod',
      severity: 'high',
      openedAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:01:00.000Z',
      lastEventAt: '2024-01-01T00:01:00.000Z',
      eventCount: 3,
      version: 2
    };

    const prompt = buildIncidentPrompt({
      incident,
      eventCount: 3,
      severityHint: 'high',
      recentEvents: [
        {
          incidentId: 'inc-1',
          tenantId: 'tenant-1',
          eventId: 'evt-1',
          source: 'checkout-service',
          type: 'error_spike',
          severityHint: 'high',
          timestamp: '2024-01-01T00:01:00.000Z',
          fingerprint: 'HTTP_500_/checkout',
          attributes: {}
        }
      ]
    });

    expect(prompt).toContain('tenantId: tenant-1');
    expect(prompt).toContain('incidentId: inc-1');
    expect(prompt).toContain('eventCount: 3');
    expect(prompt).toContain('- 2024-01-01T00:01:00.000Z | error_spike | source=checkout-service');
  });
});
