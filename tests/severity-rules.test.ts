import { evaluateSeverity } from '../services/incident-engine/src/handler';
import { RulesConfig } from '@sentinel/config';

const rules: RulesConfig = {
  rules: [
    { severity: 'medium', threshold: 2, windowMs: 300000 },
    { severity: 'high', threshold: 4, windowMs: 300000 },
    { severity: 'critical', threshold: 8, windowMs: 300000 }
  ]
};

describe('severity escalation', () => {
  it('escalates based on thresholds', () => {
    const counts = new Map<number, number>();
    counts.set(300000, 4);
    const severity = evaluateSeverity(undefined, rules, counts, 300000);
    expect(severity).toBe('high');
  });

  it('respects higher severity hint', () => {
    const counts = new Map<number, number>();
    counts.set(300000, 1);
    const severity = evaluateSeverity('high', rules, counts, 300000);
    expect(severity).toBe('high');
  });
});
