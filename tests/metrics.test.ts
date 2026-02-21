export {};

import { emitMetrics } from '@sentinel/metrics';

describe('metrics', () => {
  it('emits EMF payload to console', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    emitMetrics(
      'Sentinel',
      [{ name: 'events_ingested', unit: 'Count', value: 1 }],
      { service: 'ingest' },
      { extra: 'value' }
    );
    expect(spy).toHaveBeenCalled();
    const payload = JSON.parse(spy.mock.calls[0][0]);
    expect(payload._aws.CloudWatchMetrics[0].Namespace).toBe('Sentinel');
    expect(payload.service).toBe('ingest');
    expect(payload.events_ingested).toBe(1);
    spy.mockRestore();
  });
});
