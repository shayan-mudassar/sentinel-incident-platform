export {};

import { buildIncidentChangedDetail } from '@sentinel/events';
import { Incident } from '@sentinel/domain';

describe('events detail', () => {
  it('builds incident changed detail from incident', () => {
    const incident: Incident = {
      incidentId: 'inc-1',
      tenantId: 'tenant-1',
      status: 'OPEN',
      source: 'service',
      fingerprint: 'fp',
      env: 'prod',
      severity: 'high',
      openedAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:01.000Z',
      lastEventAt: '2024-01-01T00:00:02.000Z',
      eventCount: 3,
      version: 1
    };

    const detail = buildIncidentChangedDetail(incident, 'ESCALATED', 'corr-1', 'req-1');
    expect(detail).toEqual({
      incidentId: 'inc-1',
      tenantId: 'tenant-1',
      changeType: 'ESCALATED',
      status: 'OPEN',
      severity: 'high',
      source: 'service',
      fingerprint: 'fp',
      env: 'prod',
      updatedAt: '2024-01-01T00:00:01.000Z',
      correlationId: 'corr-1',
      requestId: 'req-1'
    });
  });
});
