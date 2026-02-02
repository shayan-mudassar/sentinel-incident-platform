import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ApiRequestError,
  ackIncident,
  getIncident,
  ingestEvent,
  listIncidents,
  normalizeBaseUrl,
  resolveIncident
} from './api';
import type { Incident, IncidentStatus, Severity } from './types';
import { formatDate, labelForSeverity, labelForStatus } from './utils';

const STORAGE_BASE_URL = 'sentinel.baseUrl';
const STORAGE_TOKEN = 'sentinel.token';

const STATUS_OPTIONS: IncidentStatus[] = ['OPEN', 'ACK', 'RESOLVED'];
const SEVERITY_OPTIONS: Severity[] = ['low', 'medium', 'high', 'critical'];

const createEventId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `evt_${Math.random().toString(16).slice(2)}`;
};

const App = () => {
  const [baseUrl, setBaseUrl] = useState(() => {
    return (
      localStorage.getItem(STORAGE_BASE_URL) ||
      import.meta.env.VITE_API_BASE_URL ||
      'http://localhost:3000'
    );
  });
  const [token, setToken] = useState(() => {
    return localStorage.getItem(STORAGE_TOKEN) || import.meta.env.VITE_AUTH_TOKEN || '';
  });

  const [statusFilter, setStatusFilter] = useState<IncidentStatus>('OPEN');
  const [sourceFilter, setSourceFilter] = useState('');
  const [envFilter, setEnvFilter] = useState('');

  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);

  const [listLoading, setListLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [eventId, setEventId] = useState(createEventId);
  const [eventSource, setEventSource] = useState('service-a');
  const [eventType, setEventType] = useState('error_spike');
  const [severityHint, setSeverityHint] = useState<Severity>('medium');
  const [fingerprint, setFingerprint] = useState('HTTP_500_/checkout');
  const [eventEnv, setEventEnv] = useState('prod');
  const [attributesText, setAttributesText] = useState(
    '{"env":"prod","region":"us-east-1","errorCode":"HTTP_500"}'
  );
  const [ingestLoading, setIngestLoading] = useState(false);
  const [ingestResult, setIngestResult] = useState<string | null>(null);

  const apiConfig = useMemo(() => {
    return { baseUrl: normalizeBaseUrl(baseUrl), token: token || undefined };
  }, [baseUrl, token]);

  const formatError = (err: unknown) => {
    if (err instanceof ApiRequestError) {
      if (err.status === 409) {
        return 'Conflict: incident updated elsewhere. Refresh and retry.';
      }
      if (err.details && typeof err.details === 'object' && err.details !== null && 'details' in err.details) {
        const detailList = (err.details as { details?: string[] }).details;
        if (Array.isArray(detailList) && detailList.length > 0) {
          return `${err.message}: ${detailList.join(', ')}`;
        }
      }
      return err.message;
    }
    if (err instanceof Error) {
      return err.message;
    }
    return 'Unexpected error.';
  };

  useEffect(() => {
    localStorage.setItem(STORAGE_BASE_URL, baseUrl);
  }, [baseUrl]);

  useEffect(() => {
    if (token) {
      localStorage.setItem(STORAGE_TOKEN, token);
      return;
    }
    localStorage.removeItem(STORAGE_TOKEN);
  }, [token]);

  const loadIncidents = useCallback(async () => {
    setListLoading(true);
    setError(null);
    setBanner(null);
    try {
      const response = await listIncidents(apiConfig, {
        status: statusFilter,
        source: sourceFilter || undefined,
        env: envFilter || undefined
      });
      setIncidents(response.items || []);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setListLoading(false);
    }
  }, [apiConfig, statusFilter, sourceFilter, envFilter]);

  const loadIncidentDetail = useCallback(
    async (incidentId: string) => {
      setDetailLoading(true);
      setError(null);
      try {
        const response = await getIncident(apiConfig, incidentId);
        setSelectedIncident(response.incident);
      } catch (err) {
        setError(formatError(err));
      } finally {
        setDetailLoading(false);
      }
    },
    [apiConfig]
  );

  useEffect(() => {
    loadIncidents();
  }, [loadIncidents]);

  useEffect(() => {
    if (!selectedId) {
      setSelectedIncident(null);
      return;
    }
    loadIncidentDetail(selectedId);
  }, [selectedId, loadIncidentDetail]);

  const handleAck = async () => {
    if (!selectedIncident) {
      return;
    }
    setActionLoading(true);
    setError(null);
    try {
      await ackIncident(apiConfig, selectedIncident.incidentId);
      setBanner('Incident acknowledged.');
      await loadIncidents();
      await loadIncidentDetail(selectedIncident.incidentId);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setActionLoading(false);
    }
  };

  const handleResolve = async () => {
    if (!selectedIncident) {
      return;
    }
    setActionLoading(true);
    setError(null);
    try {
      await resolveIncident(apiConfig, selectedIncident.incidentId);
      setBanner('Incident resolved.');
      await loadIncidents();
      await loadIncidentDetail(selectedIncident.incidentId);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setActionLoading(false);
    }
  };

  const handleIngest = async () => {
    setIngestLoading(true);
    setError(null);
    setIngestResult(null);
    try {
      const rawAttributes = attributesText.trim();
      const parsedAttributes = rawAttributes ? JSON.parse(rawAttributes) : {};
      if (typeof parsedAttributes !== 'object' || parsedAttributes === null) {
        throw new Error('Attributes JSON must be an object.');
      }

      const attributes = {
        ...(parsedAttributes as Record<string, unknown>),
        env: eventEnv || (parsedAttributes as Record<string, unknown>).env
      };

      const payload = {
        eventId,
        source: eventSource,
        type: eventType,
        severityHint,
        timestamp: new Date().toISOString(),
        fingerprint,
        attributes
      };

      const response = await ingestEvent(apiConfig, payload);
      setIngestResult(`Accepted ${response.eventId || eventId} (${response.status || 'queued'})`);
      setEventId(createEventId());
    } catch (err) {
      setError(formatError(err));
    } finally {
      setIngestLoading(false);
    }
  };

  const handleBaseUrlBlur = () => {
    setBaseUrl((current) => normalizeBaseUrl(current));
  };

  return (
    <div className="app">
      <div className="bg-orb orb-1" />
      <div className="bg-orb orb-2" />
      <div className="bg-grid" />

      <header className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Sentinel</p>
          <h1>Incident Console</h1>
          <p className="subhead">
            Track incident flow, ingest new signals, and take action with confidence.
          </p>
          {banner ? <div className="banner">{banner}</div> : null}
          {error ? <div className="banner banner-error">{error}</div> : null}
        </div>

        <div className="panel connection">
          <div className="panel-title">Connection</div>
          <label className="field">
            <span>API Base URL</span>
            <input
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              onBlur={handleBaseUrlBlur}
              placeholder="https://api.example.com/prod"
            />
          </label>
          <label className="field">
            <span>Auth Token (optional)</span>
            <textarea
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Paste a JWT or leave empty for public endpoints"
              rows={3}
            />
          </label>
          <p className="helper">Stored locally in your browser.</p>
        </div>
      </header>

      <main className="grid">
        <section className="panel incidents">
          <div className="panel-title">Incidents</div>
          <div className="filters">
            <label className="field">
              <span>Status</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as IncidentStatus)}>
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {labelForStatus(status)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Source</span>
              <input
                value={sourceFilter}
                onChange={(event) => setSourceFilter(event.target.value)}
                placeholder="service-a"
              />
            </label>
            <label className="field">
              <span>Env</span>
              <input
                value={envFilter}
                onChange={(event) => setEnvFilter(event.target.value)}
                placeholder="prod"
              />
            </label>
            <button className="button" onClick={loadIncidents} disabled={listLoading}>
              {listLoading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          <div className="list">
            {listLoading ? <div className="empty">Loading incidents…</div> : null}
            {!listLoading && incidents.length === 0 ? (
              <div className="empty">No incidents found for this filter.</div>
            ) : null}
            {incidents.map((incident, index) => (
              <button
                key={incident.incidentId}
                className={`incident-item${selectedId === incident.incidentId ? ' selected' : ''}`}
                onClick={() => setSelectedId(incident.incidentId)}
                style={{ animationDelay: `${index * 40}ms` }}
              >
                <div className="incident-row">
                  <div>
                    <div className="incident-title">{incident.fingerprint}</div>
                    <div className="incident-meta">
                      <span>{incident.source}</span>
                      <span>•</span>
                      <span>{incident.env}</span>
                      <span>•</span>
                      <span>{incident.eventCount} events</span>
                    </div>
                  </div>
                  <div className="badges">
                    <span className={`badge status ${incident.status.toLowerCase()}`}>
                      {labelForStatus(incident.status)}
                    </span>
                    <span className={`badge severity ${incident.severity}`}>
                      {labelForSeverity(incident.severity)}
                    </span>
                  </div>
                </div>
                <div className="incident-meta muted">Last event {formatDate(incident.lastEventAt)}</div>
              </button>
            ))}
          </div>
        </section>

        <section className="stack">
          <div className="panel detail">
            <div className="panel-title">Incident Detail</div>
            {!selectedIncident && !detailLoading ? (
              <div className="empty">Select an incident to view details.</div>
            ) : null}
            {detailLoading ? <div className="empty">Loading detail…</div> : null}
            {selectedIncident ? (
              <div className="detail-grid">
                <div>
                  <div className="detail-label">Incident</div>
                  <div className="detail-value">{selectedIncident.incidentId}</div>
                </div>
                <div>
                  <div className="detail-label">Status</div>
                  <div className="detail-value">{labelForStatus(selectedIncident.status)}</div>
                </div>
                <div>
                  <div className="detail-label">Severity</div>
                  <div className="detail-value">{labelForSeverity(selectedIncident.severity)}</div>
                </div>
                <div>
                  <div className="detail-label">Source</div>
                  <div className="detail-value">{selectedIncident.source}</div>
                </div>
                <div>
                  <div className="detail-label">Fingerprint</div>
                  <div className="detail-value">{selectedIncident.fingerprint}</div>
                </div>
                <div>
                  <div className="detail-label">Env</div>
                  <div className="detail-value">{selectedIncident.env}</div>
                </div>
                <div>
                  <div className="detail-label">Opened</div>
                  <div className="detail-value">{formatDate(selectedIncident.openedAt)}</div>
                </div>
                <div>
                  <div className="detail-label">Updated</div>
                  <div className="detail-value">{formatDate(selectedIncident.updatedAt)}</div>
                </div>
                <div>
                  <div className="detail-label">Last Event</div>
                  <div className="detail-value">{formatDate(selectedIncident.lastEventAt)}</div>
                </div>
                <div>
                  <div className="detail-label">Events</div>
                  <div className="detail-value">{selectedIncident.eventCount}</div>
                </div>
              </div>
            ) : null}
            <div className="actions">
              <button
                className="button ghost"
                onClick={() => selectedId && loadIncidentDetail(selectedId)}
                disabled={!selectedId || detailLoading}
              >
                Refresh detail
              </button>
              <button
                className="button"
                onClick={handleAck}
                disabled={!selectedIncident || actionLoading || selectedIncident.status !== 'OPEN'}
              >
                Ack incident
              </button>
              <button
                className="button danger"
                onClick={handleResolve}
                disabled={!selectedIncident || actionLoading || selectedIncident.status === 'RESOLVED'}
              >
                Resolve
              </button>
            </div>
          </div>

          <div className="panel ingest">
            <div className="panel-title">Ingest Event</div>
            <div className="ingest-grid">
              <label className="field">
                <span>Event ID</span>
                <div className="row">
                  <input value={eventId} readOnly />
                  <button className="button ghost" onClick={() => setEventId(createEventId())}>
                    Regenerate
                  </button>
                </div>
              </label>
              <label className="field">
                <span>Source</span>
                <input value={eventSource} onChange={(event) => setEventSource(event.target.value)} />
              </label>
              <label className="field">
                <span>Type</span>
                <input value={eventType} onChange={(event) => setEventType(event.target.value)} />
              </label>
              <label className="field">
                <span>Severity</span>
                <select value={severityHint} onChange={(event) => setSeverityHint(event.target.value as Severity)}>
                  {SEVERITY_OPTIONS.map((level) => (
                    <option key={level} value={level}>
                      {labelForSeverity(level)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Fingerprint</span>
                <input value={fingerprint} onChange={(event) => setFingerprint(event.target.value)} />
              </label>
              <label className="field">
                <span>Env</span>
                <input value={eventEnv} onChange={(event) => setEventEnv(event.target.value)} />
              </label>
              <label className="field full">
                <span>Attributes (JSON)</span>
                <textarea
                  value={attributesText}
                  onChange={(event) => setAttributesText(event.target.value)}
                  rows={4}
                />
              </label>
            </div>
            <div className="actions">
              <button className="button" onClick={handleIngest} disabled={ingestLoading}>
                {ingestLoading ? 'Sending…' : 'Send event'}
              </button>
              {ingestResult ? <span className="helper">{ingestResult}</span> : null}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};

export default App;
