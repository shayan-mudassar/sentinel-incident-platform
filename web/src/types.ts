export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type IncidentStatus = 'OPEN' | 'ACK' | 'RESOLVED';

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

export type IngestEventInput = {
  eventId: string;
  source: string;
  type: string;
  severityHint?: Severity;
  timestamp: string;
  fingerprint: string;
  attributes: Record<string, unknown>;
};
