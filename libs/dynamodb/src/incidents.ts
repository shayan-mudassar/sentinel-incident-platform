import {
  DeleteCommand,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand
} from '@aws-sdk/lib-dynamodb';
import { getDynamoDbDocClient } from '@sentinel/aws';
import { Incident, IncidentStatus, Severity } from '@sentinel/domain';

export const buildIncidentKey = (tenantId: string, env: string, source: string, fingerprint: string) => {
  return `TENANT#${tenantId}#INCIDENTKEY#${env}#${source}#${fingerprint}`;
};

const buildIncidentPk = (tenantId: string, incidentId: string) => `TENANT#${tenantId}#INCIDENT#${incidentId}`;

const buildStatusIndex = (
  tenantId: string,
  status: IncidentStatus,
  source: string,
  env: string,
  updatedAt: string
) => {
  return {
    gsi1pk: `TENANT#${tenantId}#STATUS#${status}`,
    gsi1sk: `SOURCE#${source}#ENV#${env}#UPDATED#${updatedAt}`
  };
};

export type ActiveIncidentPointer = {
  incidentId: string;
  status: IncidentStatus;
  updatedAt: string;
};

export const getActiveIncident = async (
  tableName: string,
  tenantId: string,
  env: string,
  source: string,
  fingerprint: string
): Promise<ActiveIncidentPointer | undefined> => {
  const client = getDynamoDbDocClient();
  const key = { pk: buildIncidentKey(tenantId, env, source, fingerprint), sk: 'ACTIVE' };
  const response = await client.send(
    new GetCommand({
      TableName: tableName,
      Key: key
    })
  );
  return response.Item as ActiveIncidentPointer | undefined;
};

export const getIncidentById = async (
  tableName: string,
  tenantId: string,
  incidentId: string
): Promise<Incident | undefined> => {
  const client = getDynamoDbDocClient();
  const response = await client.send(
    new GetCommand({
      TableName: tableName,
      Key: { pk: buildIncidentPk(tenantId, incidentId), sk: 'STATE' }
    })
  );
  return response.Item as Incident | undefined;
};

export type ListIncidentsOptions = {
  tenantId: string;
  status: IncidentStatus;
  source?: string;
  env?: string;
  severity?: Severity;
  ownerUserId?: string;
  from?: string;
  to?: string;
  limit?: number;
  nextToken?: Record<string, unknown>;
};

export type ListIncidentsResult = {
  items: Incident[];
  nextToken?: Record<string, unknown>;
};

export const listIncidents = async (
  tableName: string,
  options: ListIncidentsOptions
): Promise<ListIncidentsResult> => {
  const client = getDynamoDbDocClient();
  const skPrefix = options.source ? `SOURCE#${options.source}` : 'SOURCE#';
  const limit = options.limit || 50;

  const filterExpressions: string[] = [];
  const expressionAttributeValues: Record<string, unknown> = {
    ':pk': `TENANT#${options.tenantId}#STATUS#${options.status}`,
    ':sk': skPrefix
  };

  if (options.severity) {
    filterExpressions.push('severity = :severity');
    expressionAttributeValues[':severity'] = options.severity;
  }

  if (options.env) {
    filterExpressions.push('env = :env');
    expressionAttributeValues[':env'] = options.env;
  }

  if (options.ownerUserId) {
    filterExpressions.push('ownerUserId = :ownerUserId');
    expressionAttributeValues[':ownerUserId'] = options.ownerUserId;
  }

  if (options.from) {
    filterExpressions.push('updatedAt >= :from');
    expressionAttributeValues[':from'] = options.from;
  }

  if (options.to) {
    filterExpressions.push('updatedAt <= :to');
    expressionAttributeValues[':to'] = options.to;
  }

  const response = await client.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'status-index',
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :sk)',
      ExpressionAttributeNames: {
        '#pk': 'gsi1pk',
        '#sk': 'gsi1sk'
      },
      ExpressionAttributeValues: expressionAttributeValues,
      FilterExpression: filterExpressions.length > 0 ? filterExpressions.join(' AND ') : undefined,
      ExclusiveStartKey: options.nextToken,
      Limit: limit,
      ScanIndexForward: false
    })
  );

  return {
    items: (response.Items || []) as Incident[],
    nextToken: response.LastEvaluatedKey
  };
};

export const createIncident = async (
  tableName: string,
  tenantId: string,
  incident: Incident,
  env: string,
  source: string,
  fingerprint: string
) => {
  const client = getDynamoDbDocClient();
  const now = incident.updatedAt;
  const statusIndex = buildStatusIndex(tenantId, incident.status, source, env, now);
  const incidentItem = {
    ...incident,
    pk: buildIncidentPk(tenantId, incident.incidentId),
    sk: 'STATE',
    ...statusIndex
  };
  const pointerItem: ActiveIncidentPointer & { pk: string; sk: string } = {
    pk: buildIncidentKey(tenantId, env, source, fingerprint),
    sk: 'ACTIVE',
    incidentId: incident.incidentId,
    status: incident.status,
    updatedAt: now
  };

  await client.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          ConditionCheck: {
            TableName: tableName,
            Key: { pk: pointerItem.pk, sk: pointerItem.sk },
            ConditionExpression: 'attribute_not_exists(pk)'
          }
        },
        {
          Put: {
            TableName: tableName,
            Item: incidentItem
          }
        },
        {
          Put: {
            TableName: tableName,
            Item: pointerItem
          }
        }
      ]
    })
  );
};

export const updateIncident = async (
  tableName: string,
  tenantId: string,
  incidentId: string,
  updates: {
    status: IncidentStatus;
    severity: Severity;
    lastEventAt: string;
    updatedAt: string;
    eventCount: number;
    version: number;
    source: string;
    env: string;
  },
  expectedVersion: number
) => {
  const client = getDynamoDbDocClient();
  const statusIndex = buildStatusIndex(tenantId, updates.status, updates.source, updates.env, updates.updatedAt);

  await client.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { pk: buildIncidentPk(tenantId, incidentId), sk: 'STATE' },
      UpdateExpression:
        'SET #status = :status, severity = :severity, lastEventAt = :lastEventAt, updatedAt = :updatedAt, eventCount = :eventCount, version = :version, gsi1pk = :gsi1pk, gsi1sk = :gsi1sk',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':status': updates.status,
        ':severity': updates.severity,
        ':lastEventAt': updates.lastEventAt,
        ':updatedAt': updates.updatedAt,
        ':eventCount': updates.eventCount,
        ':version': updates.version,
        ':gsi1pk': statusIndex.gsi1pk,
        ':gsi1sk': statusIndex.gsi1sk,
        ':expected': expectedVersion
      },
      ConditionExpression: 'version = :expected'
    })
  );
};

export const updateActivePointer = async (
  tableName: string,
  tenantId: string,
  env: string,
  source: string,
  fingerprint: string,
  status: IncidentStatus
) => {
  const client = getDynamoDbDocClient();
  await client.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { pk: buildIncidentKey(tenantId, env, source, fingerprint), sk: 'ACTIVE' },
      UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':status': status,
        ':updatedAt': new Date().toISOString()
      },
      ConditionExpression: 'attribute_exists(pk)'
    })
  );
};

export const deleteActivePointer = async (
  tableName: string,
  tenantId: string,
  env: string,
  source: string,
  fingerprint: string
) => {
  const client = getDynamoDbDocClient();
  await client.send(
    new DeleteCommand({
      TableName: tableName,
      Key: { pk: buildIncidentKey(tenantId, env, source, fingerprint), sk: 'ACTIVE' }
    })
  );
};
