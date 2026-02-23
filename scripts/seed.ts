import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchWriteCommand, DynamoDBDocumentClient, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const stage = process.env.STAGE || 'dev';
const tenantId = process.env.TENANT_ID || 'demo';
const region = process.env.AWS_REGION || 'us-east-1';
const endpoint = process.env.DYNAMODB_ENDPOINT;
const ownerUserId = process.env.SEED_OWNER_USER_ID || undefined;

const tableNames = {
  incidents: process.env.INCIDENTS_TABLE_NAME || `sentinel-${stage}-incidents`,
  incidentEvents: process.env.INCIDENT_EVENTS_TABLE_NAME || `sentinel-${stage}-incident-events`,
  metrics: process.env.METRICS_TABLE_NAME || `sentinel-${stage}-metrics`,
  notificationTargets: process.env.NOTIFICATION_TARGETS_TABLE_NAME || `sentinel-${stage}-notification-targets`,
  rules: process.env.RULES_TABLE_NAME || `sentinel-${stage}-rules`
};

const client = new DynamoDBClient({
  region,
  endpoint,
  credentials: endpoint
    ? {
        accessKeyId: 'local',
        secretAccessKey: 'local'
      }
    : undefined
});

const docClient = DynamoDBDocumentClient.from(client);

const toStatusIndex = (status: string, source: string, env: string, updatedAt: string) => ({
  gsi1pk: `TENANT#${tenantId}#STATUS#${status}`,
  gsi1sk: `SOURCE#${source}#ENV#${env}#UPDATED#${updatedAt}`
});

const buildIncidentPk = (incidentId: string) => `TENANT#${tenantId}#INCIDENT#${incidentId}`;
const buildIncidentKey = (env: string, source: string, fingerprint: string) =>
  `TENANT#${tenantId}#INCIDENTKEY#${env}#${source}#${fingerprint}`;

const now = Date.now();
const makeTime = (offsetMinutes: number) => new Date(now - offsetMinutes * 60 * 1000).toISOString();

const incidents = [
  {
    incidentId: 'inc-demo-open',
    status: 'OPEN',
    severity: 'high',
    source: 'checkout-service',
    fingerprint: 'HTTP_500_/checkout',
    env: 'prod',
    openedAt: makeTime(120),
    updatedAt: makeTime(5),
    lastEventAt: makeTime(5),
    eventCount: 12,
    version: 3
  },
  {
    incidentId: 'inc-demo-acked',
    status: 'ACKED',
    severity: 'medium',
    source: 'payments',
    fingerprint: 'LATENCY_spike',
    env: 'prod',
    openedAt: makeTime(240),
    updatedAt: makeTime(60),
    lastEventAt: makeTime(60),
    eventCount: 7,
    version: 2
  },
  {
    incidentId: 'inc-demo-resolved',
    status: 'RESOLVED',
    severity: 'low',
    source: 'inventory',
    fingerprint: 'CACHE_miss',
    env: 'staging',
    openedAt: makeTime(360),
    updatedAt: makeTime(180),
    lastEventAt: makeTime(180),
    eventCount: 4,
    version: 5
  }
];

const incidentEvents = incidents.flatMap((incident) => {
  const events = [
    {
      eventId: `${incident.incidentId}-evt-1`,
      type: 'error_spike',
      timestamp: incident.openedAt
    },
    {
      eventId: `${incident.incidentId}-evt-2`,
      type: 'error_spike',
      timestamp: incident.lastEventAt
    }
  ];

  return events.map((event) => ({
    pk: `TENANT#${tenantId}#INCIDENT#${incident.incidentId}`,
    sk: `EVENT#${event.timestamp}#${event.eventId}`,
    tenantId,
    incidentId: incident.incidentId,
    eventId: event.eventId,
    source: incident.source,
    type: event.type,
    timestamp: event.timestamp,
    fingerprint: incident.fingerprint,
    attributes: { env: incident.env },
    expiresAt: Math.floor((Date.now() + 7 * 24 * 60 * 60 * 1000) / 1000)
  }));
});

const run = async () => {
  console.log('Seeding Sentinel demo data...');
  console.log('Tables:', tableNames);

  for (const incident of incidents) {
    const item = {
      ...incident,
      tenantId,
      ownerUserId,
      pk: buildIncidentPk(incident.incidentId),
      sk: 'STATE',
      ...toStatusIndex(incident.status, incident.source, incident.env, incident.updatedAt)
    };

    await docClient.send(
      new PutCommand({
        TableName: tableNames.incidents,
        Item: item
      })
    );

    if (incident.status !== 'RESOLVED') {
      await docClient.send(
        new PutCommand({
          TableName: tableNames.incidents,
          Item: {
            pk: buildIncidentKey(incident.env, incident.source, incident.fingerprint),
            sk: 'ACTIVE',
            incidentId: incident.incidentId,
            status: incident.status,
            updatedAt: incident.updatedAt
          }
        })
      );
    }
  }

  const eventBatches = [] as typeof incidentEvents[];
  for (let i = 0; i < incidentEvents.length; i += 25) {
    eventBatches.push(incidentEvents.slice(i, i + 25));
  }

  for (const batch of eventBatches) {
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [tableNames.incidentEvents]: batch.map((event) => ({
            PutRequest: { Item: event }
          }))
        }
      })
    );
  }

  await docClient.send(
    new UpdateCommand({
      TableName: tableNames.metrics,
      Key: { pk: `TENANT#${tenantId}`, sk: 'METRIC#ingested_total' },
      UpdateExpression: 'SET #count = :count, updatedAt = :updatedAt, tenantId = :tenantId, metricName = :metricName',
      ExpressionAttributeNames: { '#count': 'count' },
      ExpressionAttributeValues: {
        ':count': 42,
        ':updatedAt': new Date().toISOString(),
        ':tenantId': tenantId,
        ':metricName': 'ingested_total'
      }
    })
  );

  await docClient.send(
    new UpdateCommand({
      TableName: tableNames.metrics,
      Key: { pk: `TENANT#${tenantId}`, sk: 'METRIC#deduped_total' },
      UpdateExpression: 'SET #count = :count, updatedAt = :updatedAt, tenantId = :tenantId, metricName = :metricName',
      ExpressionAttributeNames: { '#count': 'count' },
      ExpressionAttributeValues: {
        ':count': 7,
        ':updatedAt': new Date().toISOString(),
        ':tenantId': tenantId,
        ':metricName': 'deduped_total'
      }
    })
  );

  await docClient.send(
    new PutCommand({
      TableName: tableNames.notificationTargets,
      Item: {
        pk: `TENANT#${tenantId}`,
        sk: 'SEVERITY#ALL',
        tenantId,
        severity: 'ALL',
        targets: [
          {
            type: 'SNS',
            topicArn:
              process.env.NOTIFICATION_TOPIC_ARN ||
              `arn:aws:sns:${region}:123456789012:sentinel-${stage}-notifications`,
            label: 'default'
          }
        ]
      }
    })
  );

  await docClient.send(
    new PutCommand({
      TableName: tableNames.rules,
      Item: {
        ruleId: `TENANT#${tenantId}`,
        rules: [
          { severity: 'medium', threshold: 3, windowMs: 300000 },
          { severity: 'high', threshold: 6, windowMs: 300000 },
          { severity: 'critical', threshold: 12, windowMs: 300000 }
        ]
      }
    })
  );

  console.log('Seed completed.');
};

run().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
