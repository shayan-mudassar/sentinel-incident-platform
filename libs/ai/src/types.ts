import { Incident, IncidentEvent, Severity } from '@sentinel/domain';

export type AiAnalysisInput = {
  incident: Incident;
  recentEvents: IncidentEvent[];
  severityHint?: Severity;
  eventCount: number;
};

export type AiAnalysisRequest = AiAnalysisInput & {
  prompt: string;
};

export type AiAnalysisOutput = {
  aiSummary: string;
  aiSeverityRecommendation: Severity;
  aiSuggestedActions: string[];
  aiConfidence: number;
  aiModel: string;
  aiProvider: string;
};

export type AiProvider = {
  name: string;
  analyzeIncident: (input: AiAnalysisRequest) => Promise<Partial<AiAnalysisOutput>>;
};
