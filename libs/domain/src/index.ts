export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type IncidentStatus = 'OPEN' | 'ACKED' | 'RESOLVED';

export type IngestEvent = {
  eventId: string;
  source: string;
  type: string;
  severityHint?: Severity;
  idempotencyKey?: string;
  timestamp: string;
  fingerprint: string;
  attributes: Record<string, unknown>;
};

export type Incident = {
  incidentId: string;
  tenantId: string;
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
  aiSummary?: string;
  aiSeverityRecommendation?: Severity;
  aiSuggestedActions?: string[];
  aiConfidence?: number;
  aiLastAnalyzedAt?: string;
  aiModel?: string;
  aiProvider?: string;
  aiStatus?: 'pending' | 'completed' | 'failed' | 'skipped';
  aiError?: string;
  aiIncidentVersion?: number;
};

export type IncidentEvent = {
  incidentId: string;
  tenantId: string;
  eventId: string;
  source: string;
  type: string;
  severityHint?: Severity;
  timestamp: string;
  fingerprint: string;
  attributes: Record<string, unknown>;
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
