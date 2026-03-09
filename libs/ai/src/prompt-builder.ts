import { AiAnalysisInput } from './types';

export const buildIncidentPrompt = (input: AiAnalysisInput) => {
  const { incident, recentEvents, eventCount, severityHint } = input;
  const recentEventLines = recentEvents
    .slice(0, 5)
    .map((event) => {
      const parts = [
        `${event.timestamp}`,
        `${event.type}`,
        `source=${event.source}`,
        `fingerprint=${event.fingerprint}`
      ];
      if (event.severityHint) {
        parts.push(`severityHint=${event.severityHint}`);
      }
      return `- ${parts.join(' | ')}`;
    })
    .join('\n');

  return [
    'You are an incident response assistant. Produce a concise JSON object with:',
    'summary, severityRecommendation, suggestedActions (array), confidence (0-1).',
    'Use severityRecommendation from: low, medium, high, critical.',
    'Keep summary under 40 words. Suggested actions should be short phrases.',
    '',
    'Incident context:',
    `tenantId: ${incident.tenantId}`,
    `incidentId: ${incident.incidentId}`,
    `status: ${incident.status}`,
    `env: ${incident.env}`,
    `source: ${incident.source}`,
    `fingerprint: ${incident.fingerprint}`,
    `currentSeverity: ${incident.severity}`,
    `eventCount: ${eventCount}`,
    `severityHint: ${severityHint || 'none'}`,
    `openedAt: ${incident.openedAt}`,
    `updatedAt: ${incident.updatedAt}`,
    `lastEventAt: ${incident.lastEventAt}`,
    '',
    'Recent events:',
    recentEventLines || '- none'
  ].join('\n');
};
