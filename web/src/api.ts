import type { Incident, IncidentStatus, IngestEventInput } from './types';

export type ApiConfig = {
  baseUrl: string;
  token?: string;
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
};

export const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, '');

export const buildHeaders = (token?: string) => {
  const headers: Record<string, string> = {
    'content-type': 'application/json'
  };

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
    const message = (data as { error?: string })?.error || response.statusText || 'Request failed';
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

  const query = params.toString();
  return request<{ items: Incident[] }>(`/v1/incidents${query ? `?${query}` : ''}`,
    {
      method: 'GET',
      headers: buildHeaders(config.token)
    },
    config
  );
};

export const getIncident = async (config: ApiConfig, incidentId: string) => {
  return request<{ incident: Incident }>(`/v1/incidents/${encodeURIComponent(incidentId)}`,
    {
      method: 'GET',
      headers: buildHeaders(config.token)
    },
    config
  );
};

export const ackIncident = async (config: ApiConfig, incidentId: string) => {
  return request<{ incidentId: string; status: IncidentStatus }>(
    `/v1/incidents/${encodeURIComponent(incidentId)}/ack`,
    {
      method: 'POST',
      headers: buildHeaders(config.token)
    },
    config
  );
};

export const resolveIncident = async (config: ApiConfig, incidentId: string) => {
  return request<{ incidentId: string; status: IncidentStatus }>(
    `/v1/incidents/${encodeURIComponent(incidentId)}/resolve`,
    {
      method: 'POST',
      headers: buildHeaders(config.token)
    },
    config
  );
};

export const ingestEvent = async (config: ApiConfig, payload: IngestEventInput) => {
  return request<{ accepted?: boolean; eventId?: string; status?: string }>(
    '/v1/events',
    {
      method: 'POST',
      headers: buildHeaders(config.token),
      body: JSON.stringify(payload)
    },
    config
  );
};
