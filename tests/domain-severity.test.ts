export {};

import { maxSeverity, severityRank } from '../libs/domain/src';

describe('domain severity helpers', () => {
  it('returns higher severity', () => {
    expect(maxSeverity('low', 'high')).toBe('high');
    expect(maxSeverity('critical', 'medium')).toBe('critical');
  });

  it('orders severities by rank', () => {
    expect(severityRank.critical).toBeGreaterThan(severityRank.high);
    expect(severityRank.high).toBeGreaterThan(severityRank.medium);
    expect(severityRank.medium).toBeGreaterThan(severityRank.low);
  });
});
