import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { getDynamoDbDocClient } from '@sentinel/aws';
import { Severity } from '@sentinel/domain';

export type SeverityRule = {
  severity: Severity;
  threshold: number;
  windowMs: number;
};

export type RulesConfig = {
  rules: SeverityRule[];
  dedupWindowMs?: number;
  severityWindowMs?: number;
};

export const defaultRules: RulesConfig = {
  rules: [
    { severity: 'medium', threshold: 5, windowMs: 5 * 60 * 1000 },
    { severity: 'high', threshold: 10, windowMs: 5 * 60 * 1000 },
    { severity: 'critical', threshold: 20, windowMs: 5 * 60 * 1000 }
  ]
};

const fetchRules = async (rulesTableName: string, ruleId: string): Promise<RulesConfig | undefined> => {
  const client = getDynamoDbDocClient();
  const response = await client.send(
    new GetCommand({
      TableName: rulesTableName,
      Key: { ruleId }
    })
  );

  if (response.Item && Array.isArray((response.Item as RulesConfig).rules)) {
    return response.Item as RulesConfig;
  }

  return undefined;
};

export const loadRules = async (
  rulesTableName?: string,
  tenantId?: string
): Promise<RulesConfig> => {
  if (!rulesTableName) {
    return defaultRules;
  }

  try {
    if (tenantId) {
      const tenantRules = await fetchRules(rulesTableName, `TENANT#${tenantId}`);
      if (tenantRules) {
        return tenantRules;
      }
    }

    const defaultConfig = await fetchRules(rulesTableName, 'default');
    if (defaultConfig) {
      return defaultConfig;
    }
  } catch {
    return defaultRules;
  }

  return defaultRules;
};
