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
};

export const defaultRules: RulesConfig = {
  rules: [
    { severity: 'medium', threshold: 5, windowMs: 5 * 60 * 1000 },
    { severity: 'high', threshold: 10, windowMs: 5 * 60 * 1000 },
    { severity: 'critical', threshold: 20, windowMs: 5 * 60 * 1000 }
  ]
};

export const loadRules = async (rulesTableName?: string): Promise<RulesConfig> => {
  if (!rulesTableName) {
    return defaultRules;
  }

  const client = getDynamoDbDocClient();
  try {
    const response = await client.send(
      new GetCommand({
        TableName: rulesTableName,
        Key: { ruleId: 'default' }
      })
    );

    if (response.Item && Array.isArray((response.Item as RulesConfig).rules)) {
      return response.Item as RulesConfig;
    }
  } catch {
    return defaultRules;
  }

  return defaultRules;
};
