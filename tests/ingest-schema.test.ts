import { validateIngestEvent } from '@sentinel/schemas';

describe('validateIngestEvent', () => {
  it('accepts a valid event', () => {
    const result = validateIngestEvent({
      eventId: '123',
      source: 'service-a',
      type: 'error_spike',
      severityHint: 'medium',
      timestamp: new Date().toISOString(),
      fingerprint: 'HTTP_500_/checkout',
      attributes: { env: 'dev' }
    });

    expect(result.valid).toBe(true);
  });

  it('rejects an invalid event', () => {
    const result = validateIngestEvent({
      source: 'service-a'
    });

    expect(result.valid).toBe(false);
  });
});
