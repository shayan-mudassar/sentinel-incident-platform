import type { IncidentStatus, Severity } from './types';

export const formatDate = (value?: string) => {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
};

export const labelForStatus = (status: IncidentStatus) => {
  return status === 'ACK' ? 'Acknowledged' : status === 'RESOLVED' ? 'Resolved' : 'Open';
};

export const labelForSeverity = (severity: Severity) => {
  return severity.charAt(0).toUpperCase() + severity.slice(1);
};
