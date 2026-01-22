export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type IncidentStatus = 'OPEN' | 'ACK' | 'RESOLVED';

export type IngestEvent = {
  eventId: string;
  source: string;
  type: string;
  severityHint?: Severity;
  timestamp: string;
  fingerprint: string;
  attributes: Record<string, unknown>;
};

export type Incident = {
  incidentId: string;
  status: IncidentStatus;
  source: string;
  fingerprint: string;
  env: string;
  severity: Severity;
  openedAt: string;
  updatedAt: string;
  lastEventAt: string;
  eventCount: number;
  version: number;
};

export const severityRank: Record<Severity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
};

export const maxSeverity = (left: Severity, right: Severity): Severity => {
  return severityRank[left] >= severityRank[right] ? left : right;
};
