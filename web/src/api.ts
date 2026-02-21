import type { Incident, IncidentEvent, IncidentStatus, IngestEventInput, MetricsResponse, Severity } from './types';

export type ApiConfig = {
  baseUrl: string;
  token?: string;
  tenantId: string;
};

export type ApiError = {
  status: number;
  message: string;
  details?: unknown;
};

export class ApiRequestError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.details = details;
  }
}

export type ListFilters = {
  status?: IncidentStatus;
  source?: string;
  env?: string;
  severity?: Severity;
  from?: string;
  to?: string;
  limit?: number;
  nextToken?: string;
};

export const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, '');

export const buildHeaders = (tenantId: string, token?: string) => {
  const headers: Record<string, string> = {
    'content-type': 'application/json'
  };

  headers['X-Tenant-Id'] = tenantId;

  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  return headers;
};

const parseJson = async (response: Response) => {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
};

const request = async <T>(
  path: string,
  options: RequestInit,
  config: ApiConfig
): Promise<T> => {
  const response = await fetch(`${normalizeBaseUrl(config.baseUrl)}${path}`, options);
  const data = await parseJson(response);

  if (!response.ok) {
    const message =
      (data as { message?: string })?.message ||
      (data as { error?: string })?.error ||
      response.statusText ||
      'Request failed';
    throw new ApiRequestError(response.status, message, data);
  }

  return data as T;
};

export const listIncidents = async (config: ApiConfig, filters: ListFilters) => {
  const params = new URLSearchParams();
  if (filters.status) {
    params.set('status', filters.status);
  }
  if (filters.source) {
    params.set('source', filters.source);
  }
  if (filters.env) {
    params.set('env', filters.env);
  }
  if (filters.severity) {
    params.set('severity', filters.severity);
  }
  if (filters.from) {
    params.set('from', filters.from);
  }
  if (filters.to) {
    params.set('to', filters.to);
  }
  if (filters.limit) {
    params.set('limit', String(filters.limit));
  }
  if (filters.nextToken) {
    params.set('nextToken', filters.nextToken);
  }

  const query = params.toString();
  return request<{ items: Incident[]; nextToken?: string }>(`/v1/incidents${query ? `?${query}` : ''}`,
    {
      method: 'GET',
      headers: buildHeaders(config.tenantId, config.token)
    },
    config
  );
};

export const getIncident = async (config: ApiConfig, incidentId: string) => {
  return request<{ incident: Incident }>(`/v1/incidents/${encodeURIComponent(incidentId)}`,
    {
      method: 'GET',
      headers: buildHeaders(config.tenantId, config.token)
    },
    config
  );
};

export const listIncidentEvents = async (
  config: ApiConfig,
  incidentId: string,
  limit = 25,
  nextToken?: string
) => {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  if (nextToken) {
    params.set('nextToken', nextToken);
  }
  return request<{ items: IncidentEvent[]; nextToken?: string }>(
    `/v1/incidents/${encodeURIComponent(incidentId)}/events?${params.toString()}`,
    {
      method: 'GET',
      headers: buildHeaders(config.tenantId, config.token)
    },
    config
  );
};

export const ackIncident = async (config: ApiConfig, incidentId: string) => {
  return request<{ incidentId: string; status: IncidentStatus }>(
    `/v1/incidents/${encodeURIComponent(incidentId)}/ack`,
    {
      method: 'POST',
      headers: buildHeaders(config.tenantId, config.token)
    },
    config
  );
};

export const resolveIncident = async (config: ApiConfig, incidentId: string) => {
  return request<{ incidentId: string; status: IncidentStatus }>(
    `/v1/incidents/${encodeURIComponent(incidentId)}/resolve`,
    {
      method: 'POST',
      headers: buildHeaders(config.tenantId, config.token)
    },
    config
  );
};

export const getMetrics = async (config: ApiConfig) => {
  return request<MetricsResponse>(
    '/v1/metrics',
    {
      method: 'GET',
      headers: buildHeaders(config.tenantId, config.token)
    },
    config
  );
};

export const ingestEvent = async (config: ApiConfig, payload: IngestEventInput) => {
  return request<{ accepted?: boolean; eventId?: string; status?: string }>(
    '/v1/events',
    {
      method: 'POST',
      headers: buildHeaders(config.tenantId, config.token),
      body: JSON.stringify(payload)
    },
    config
  );
};
