import { AiAnalysisInput, AiAnalysisOutput, AiProvider, AiAnalysisRequest } from './types';
import { buildIncidentPrompt } from './prompt-builder';
import { createOpenAiProvider } from './openai-provider';
import { createMockProvider } from './mock-provider';

export type AiProviderConfig = {
  aiProvider: string;
  aiModel: string;
  aiTimeoutMs: number;
  aiMaxRetries: number;
  openaiApiKey?: string;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number) => {
  if (timeoutMs <= 0) {
    return promise;
  }
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

export const retry = async <T>(fn: () => Promise<T>, retries: number, backoffMs = 200) => {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= retries) {
        throw error;
      }
      await sleep(backoffMs * Math.pow(2, attempt));
      attempt += 1;
    }
  }
};

export const normalizeOutput = (
  output: Partial<AiAnalysisOutput>,
  model: string,
  provider: string
): AiAnalysisOutput => {
  const summary = (output.aiSummary || '').trim();
  const severityRaw =
    typeof output.aiSeverityRecommendation === 'string'
      ? output.aiSeverityRecommendation.toLowerCase()
      : undefined;
  const severity =
    severityRaw === 'low' || severityRaw === 'medium' || severityRaw === 'high' || severityRaw === 'critical'
      ? (severityRaw as AiAnalysisOutput['aiSeverityRecommendation'])
      : 'low';
  const actions = Array.isArray(output.aiSuggestedActions) ? output.aiSuggestedActions.map((a) => String(a)) : [];
  const confidenceRaw = typeof output.aiConfidence === 'number' ? output.aiConfidence : 0.3;
  const confidence = Math.min(1, Math.max(0, confidenceRaw));

  return {
    aiSummary: summary || 'No summary available.',
    aiSeverityRecommendation: severity,
    aiSuggestedActions: actions.length > 0 ? actions : ['Review logs', 'Confirm impact', 'Notify stakeholders'],
    aiConfidence: confidence,
    aiModel: output.aiModel || model,
    aiProvider: output.aiProvider || provider
  };
};

export const createAiProvider = (config: AiProviderConfig): AiProvider => {
  const providerName = config.aiProvider?.toLowerCase() || 'mock';
  switch (providerName) {
    case 'openai':
      return createOpenAiProvider({
        model: config.aiModel,
        apiKey: config.openaiApiKey
      });
    case 'mock':
    default:
      return createMockProvider(config.aiModel || 'mock');
  }
};

export const analyzeWithProvider = async (
  provider: AiProvider,
  input: AiAnalysisInput,
  config: AiProviderConfig
): Promise<AiAnalysisOutput> => {
  return retry(async () => {
    const prompt = buildIncidentPrompt(input);
    const request: AiAnalysisRequest = { ...input, prompt };
    const result = await withTimeout(provider.analyzeIncident(request), config.aiTimeoutMs);
    return normalizeOutput(result, config.aiModel, provider.name);
  }, config.aiMaxRetries);
};
