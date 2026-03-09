import { AiAnalysisRequest, AiProvider } from './types';
import { Severity } from '@sentinel/domain';

export type OpenAiProviderConfig = {
  apiKey?: string;
  model: string;
  baseUrl?: string;
};

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

const extractJson = (text: string) => {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('empty_ai_response');
  }
  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed) as Record<string, unknown>;
  }
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error('invalid_ai_response');
  }
  return JSON.parse(match[0]) as Record<string, unknown>;
};

const normalizeActions = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry)).filter((entry) => entry.length > 0);
  }
  return [];
};

export const createOpenAiProvider = (config: OpenAiProviderConfig): AiProvider => {
  const baseUrl = config.baseUrl || 'https://api.openai.com/v1';
  const model = config.model;
  return {
    name: 'openai',
    analyzeIncident: async (input: AiAnalysisRequest) => {
      if (!config.apiKey) {
        throw new Error('missing_openai_api_key');
      }

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          messages: [
            {
              role: 'user',
              content: input.prompt
            }
          ]
        })
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`openai_error_${response.status}: ${body.slice(0, 200)}`);
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = payload.choices?.[0]?.message?.content || '';
      const parsed = extractJson(content);
      const summary = parsed.summary ?? parsed.aiSummary;
      const severity = parsed.severityRecommendation ?? parsed.aiSeverityRecommendation;
      const actions = parsed.suggestedActions ?? parsed.aiSuggestedActions;
      const confidence = parsed.confidence ?? parsed.aiConfidence;

      return {
        aiSummary: typeof summary === 'string' ? summary : '',
        aiSeverityRecommendation: normalizeSeverity(
          typeof severity === 'string' ? severity : undefined
        ),
        aiSuggestedActions: normalizeActions(actions),
        aiConfidence: typeof confidence === 'number' ? confidence : 0.3,
        aiModel: model,
        aiProvider: 'openai'
      };
    }
  };
};
