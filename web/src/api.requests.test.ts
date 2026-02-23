import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ackIncident,
  getIncident,
  getMetrics,
  ingestEvent,
  listIncidentEvents,
  listIncidents,
  resolveIncident
} from './api';

const baseConfig = {
  baseUrl: 'http://localhost:3000/',
  tenantId: 'tenant-1',
  token: 'token-123'
};

const mockFetch = (data: unknown) => {
  const fetchMock = vi.fn(async () => {
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => data
    } as Response;
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

describe('api request builders', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds list incident query and headers', async () => {
    const fetchMock = mockFetch({ items: [] });

    await listIncidents(baseConfig, {
      status: 'OPEN',
      source: 'svc',
      env: 'prod',
      severity: 'high',
      from: '2024-01-01',
      to: '2024-01-02',
      pageSize: 20,
      nextToken: 'token'
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/v1/incidents?status=OPEN&source=svc&env=prod&severity=high&from=2024-01-01&to=2024-01-02&pageSize=20&nextToken=token',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'content-type': 'application/json',
          'X-Tenant-Id': 'tenant-1',
          authorization: 'Bearer token-123'
        })
      })
    );
  });

  it('encodes incident id in getIncident', async () => {
    const fetchMock = mockFetch({ incident: { incidentId: 'inc%2F1' } });

    await getIncident(baseConfig, 'inc/1');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/v1/incidents/inc%2F1',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('uses default limit for incident events', async () => {
    const fetchMock = mockFetch({ items: [] });

    await listIncidentEvents(baseConfig, 'inc-1');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/v1/incidents/inc-1/events?pageSize=25',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('posts ack and resolve requests', async () => {
    const fetchMock = mockFetch({ incidentId: 'inc-1', status: 'ACKED' });

    await ackIncident(baseConfig, 'inc-1');
    await resolveIncident(baseConfig, 'inc-2');

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://localhost:3000/v1/incidents/inc-1/ack',
      expect.objectContaining({ method: 'POST' })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:3000/v1/incidents/inc-2/resolve',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('requests metrics and ingest endpoints', async () => {
    const fetchMock = mockFetch({ metrics: { ingested: 1, deduped: 0 } });

    await getMetrics(baseConfig);
    await ingestEvent(baseConfig, {
      eventId: 'evt-1',
      source: 'svc',
      type: 'error',
      timestamp: '2024-01-01T00:00:00.000Z',
      fingerprint: 'fp',
      attributes: {}
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://localhost:3000/v1/metrics',
      expect.objectContaining({ method: 'GET' })
    );

    const ingestCall = fetchMock.mock.calls[1];
    expect(ingestCall[0]).toBe('http://localhost:3000/v1/events');
    expect(ingestCall[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          eventId: 'evt-1',
          source: 'svc',
          type: 'error',
          timestamp: '2024-01-01T00:00:00.000Z',
          fingerprint: 'fp',
          attributes: {}
        })
      })
    );
  });
});
