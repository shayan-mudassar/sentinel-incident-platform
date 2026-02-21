import { Incident, IncidentStatus, Severity } from '@sentinel/domain';

export type IncidentChangeType = 'OPENED' | 'ESCALATED' | 'ACKED' | 'RESOLVED' | 'UPDATED';

export type IncidentChangedDetail = {
  incidentId: string;
  tenantId: string;
  changeType: IncidentChangeType;
  status: IncidentStatus;
  severity: Severity;
  source: string;
  fingerprint: string;
  env: string;
  updatedAt: string;
  correlationId?: string;
};

export const buildIncidentChangedDetail = (
  incident: Incident,
  changeType: IncidentChangeType,
  correlationId?: string
): IncidentChangedDetail => {
  return {
    incidentId: incident.incidentId,
    tenantId: incident.tenantId,
    changeType,
    status: incident.status,
    severity: incident.severity,
    source: incident.source,
    fingerprint: incident.fingerprint,
    env: incident.env,
    updatedAt: incident.updatedAt,
    correlationId
  };
};
