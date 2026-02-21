import { describe, expect, it } from 'vitest';
import { formatDate, labelForSeverity, labelForStatus } from './utils';

describe('utils', () => {
  it('formats missing dates', () => {
    expect(formatDate()).toBe('—');
  });

  it('returns raw string for invalid date', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });

  it('formats valid dates', () => {
    const input = '2024-01-01T00:00:00.000Z';
    const expected = new Date(input).toLocaleString();
    expect(formatDate(input)).toBe(expected);
  });

  it('labels incident status', () => {
    expect(labelForStatus('OPEN')).toBe('Open');
    expect(labelForStatus('ACKED')).toBe('Acknowledged');
    expect(labelForStatus('RESOLVED')).toBe('Resolved');
  });

  it('labels severity', () => {
    expect(labelForSeverity('low')).toBe('Low');
    expect(labelForSeverity('critical')).toBe('Critical');
  });
});
