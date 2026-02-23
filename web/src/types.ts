export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type IncidentStatus = 'OPEN' | 'ACKED' | 'RESOLVED';

export type Incident = {
  incidentId: string;
  tenantId?: string;
  ownerUserId?: string;
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

export type IncidentEvent = {
  eventId: string;
  source: string;
  type: string;
  severityHint?: Severity;
  timestamp: string;
  fingerprint: string;
  attributes: Record<string, unknown>;
};

export type MetricsResponse = {
  metrics: {
    ingested: number;
    deduped: number;
  };
  updatedAt?: {
    ingested?: string;
    deduped?: string;
  };
};

export type IngestEventInput = {
  eventId: string;
  source: string;
  type: string;
  severityHint?: Severity;
  idempotencyKey?: string;
  timestamp: string;
  fingerprint: string;
  attributes: Record<string, unknown>;
};
