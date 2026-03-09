import { AiAnalysisRequest, AiProvider } from './types';
import { Severity } from '@sentinel/domain';

const normalizeSeverity = (value?: string): Severity => {
  if (!value) {
    return 'low';
  }
  const lower = value.toLowerCase();
  if (lower === 'low' || lower === 'medium' || lower === 'high' || lower === 'critical') {
    return lower as Severity;
  }
  return 'low';
};

export const createMockProvider = (model: string): AiProvider => ({
  name: 'mock',
  analyzeIncident: async (input: AiAnalysisRequest) => {
    const incident = input.incident;
    const summary = `Incident ${incident.fingerprint} in ${incident.env} from ${incident.source}.`;
    const recommendation = normalizeSeverity(input.severityHint || incident.severity);
    return {
      aiSummary: summary,
      aiSeverityRecommendation: recommendation,
      aiSuggestedActions: ['Check recent deploys', 'Review error logs', 'Notify on-call'],
      aiConfidence: 0.42,
      aiModel: model,
      aiProvider: 'mock'
    };
  }
});
