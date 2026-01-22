import {
  DeleteCommand,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand
} from '@aws-sdk/lib-dynamodb';
import { getDynamoDbDocClient } from '@sentinel/aws';
import { Incident, IncidentStatus, Severity } from '@sentinel/domain';

export const buildIncidentKey = (env: string, source: string, fingerprint: string) => {
  return `INCIDENTKEY#${env}#${source}#${fingerprint}`;
};

const buildIncidentPk = (incidentId: string) => `INCIDENT#${incidentId}`;

const buildStatusIndex = (status: IncidentStatus, source: string, env: string, updatedAt: string) => {
  return {
    gsi1pk: `STATUS#${status}`,
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
  env: string,
  source: string,
  fingerprint: string
): Promise<ActiveIncidentPointer | undefined> => {
  const client = getDynamoDbDocClient();
  const key = { pk: buildIncidentKey(env, source, fingerprint), sk: 'ACTIVE' };
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
  incidentId: string
): Promise<Incident | undefined> => {
  const client = getDynamoDbDocClient();
  const response = await client.send(
    new GetCommand({
      TableName: tableName,
      Key: { pk: buildIncidentPk(incidentId), sk: 'STATE' }
    })
  );
  return response.Item as Incident | undefined;
};

export const listIncidents = async (
  tableName: string,
  status: IncidentStatus,
  source?: string,
  env?: string,
  limit = 50
): Promise<Incident[]> => {
  const client = getDynamoDbDocClient();
  const sourcePrefix = source ? `SOURCE#${source}` : 'SOURCE#';
  const envFragment = env ? `#ENV#${env}` : '';
  const skPrefix = `${sourcePrefix}${envFragment}`;

  const response = await client.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'status-index',
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :sk)',
      ExpressionAttributeNames: {
        '#pk': 'gsi1pk',
        '#sk': 'gsi1sk'
      },
      ExpressionAttributeValues: {
        ':pk': `STATUS#${status}`,
        ':sk': skPrefix
      },
      Limit: limit,
      ScanIndexForward: false
    })
  );

  return (response.Items || []) as Incident[];
};

export const createIncident = async (
  tableName: string,
  incident: Incident,
  env: string,
  source: string,
  fingerprint: string
) => {
  const client = getDynamoDbDocClient();
  const now = incident.updatedAt;
  const statusIndex = buildStatusIndex(incident.status, source, env, now);
  const incidentItem = {
    ...incident,
    pk: buildIncidentPk(incident.incidentId),
    sk: 'STATE',
    ...statusIndex
  };
  const pointerItem: ActiveIncidentPointer & { pk: string; sk: string } = {
    pk: buildIncidentKey(env, source, fingerprint),
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
  const statusIndex = buildStatusIndex(updates.status, updates.source, updates.env, updates.updatedAt);

  await client.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { pk: buildIncidentPk(incidentId), sk: 'STATE' },
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
  env: string,
  source: string,
  fingerprint: string,
  status: IncidentStatus
) => {
  const client = getDynamoDbDocClient();
  await client.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { pk: buildIncidentKey(env, source, fingerprint), sk: 'ACTIVE' },
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
  env: string,
  source: string,
  fingerprint: string
) => {
  const client = getDynamoDbDocClient();
  await client.send(
    new DeleteCommand({
      TableName: tableName,
      Key: { pk: buildIncidentKey(env, source, fingerprint), sk: 'ACTIVE' }
    })
  );
};
