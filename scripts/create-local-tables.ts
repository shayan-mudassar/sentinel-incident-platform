import {
  CreateTableCommand,
  DynamoDBClient,
  waitUntilTableExists,
  type CreateTableCommandInput
} from '@aws-sdk/client-dynamodb';

const stage = process.env.STAGE || 'dev';
const region = process.env.AWS_REGION || 'us-east-1';
const endpoint = process.env.DYNAMODB_ENDPOINT || 'http://localhost:8000';

const tableNames = {
  incidents: process.env.INCIDENTS_TABLE_NAME || `sentinel-${stage}-incidents`,
  eventState: process.env.EVENT_STATE_TABLE_NAME || `sentinel-${stage}-event-state`,
  incidentEvents: process.env.INCIDENT_EVENTS_TABLE_NAME || `sentinel-${stage}-incident-events`,
  outbox: process.env.OUTBOX_TABLE_NAME || `sentinel-${stage}-outbox`,
  idempotency: process.env.IDEMPOTENCY_TABLE_NAME || `sentinel-${stage}-idempotency`,
  rules: process.env.RULES_TABLE_NAME || `sentinel-${stage}-rules`,
  notificationTargets: process.env.NOTIFICATION_TARGETS_TABLE_NAME || `sentinel-${stage}-notification-targets`,
  metrics: process.env.METRICS_TABLE_NAME || `sentinel-${stage}-metrics`
};

const client = new DynamoDBClient({
  region,
  endpoint,
  credentials: {
    accessKeyId: 'local',
    secretAccessKey: 'local'
  }
});

const ensureTable = async (input: CreateTableCommandInput) => {
  try {
    await client.send(new CreateTableCommand(input));
    await waitUntilTableExists({ client, maxWaitTime: 20 }, { TableName: input.TableName });
    console.log(`Created table ${input.TableName}`);
  } catch (error) {
    if ((error as { name?: string }).name === 'ResourceInUseException') {
      console.log(`Table ${input.TableName} already exists`);
      return;
    }
    throw error;
  }
};

const run = async () => {
  console.log('Creating DynamoDB Local tables...');

  await ensureTable({
    TableName: tableNames.incidents,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'pk', AttributeType: 'S' },
      { AttributeName: 'sk', AttributeType: 'S' },
      { AttributeName: 'gsi1pk', AttributeType: 'S' },
      { AttributeName: 'gsi1sk', AttributeType: 'S' }
    ],
    KeySchema: [
      { AttributeName: 'pk', KeyType: 'HASH' },
      { AttributeName: 'sk', KeyType: 'RANGE' }
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'status-index',
        KeySchema: [
          { AttributeName: 'gsi1pk', KeyType: 'HASH' },
          { AttributeName: 'gsi1sk', KeyType: 'RANGE' }
        ],
        Projection: { ProjectionType: 'ALL' }
      }
    ]
  });

  await ensureTable({
    TableName: tableNames.eventState,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'pk', AttributeType: 'S' },
      { AttributeName: 'sk', AttributeType: 'S' }
    ],
    KeySchema: [
      { AttributeName: 'pk', KeyType: 'HASH' },
      { AttributeName: 'sk', KeyType: 'RANGE' }
    ]
  });

  await ensureTable({
    TableName: tableNames.incidentEvents,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'pk', AttributeType: 'S' },
      { AttributeName: 'sk', AttributeType: 'S' }
    ],
    KeySchema: [
      { AttributeName: 'pk', KeyType: 'HASH' },
      { AttributeName: 'sk', KeyType: 'RANGE' }
    ]
  });

  await ensureTable({
    TableName: tableNames.outbox,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'outboxId', AttributeType: 'S' },
      { AttributeName: 'status', AttributeType: 'S' },
      { AttributeName: 'createdAt', AttributeType: 'S' }
    ],
    KeySchema: [{ AttributeName: 'outboxId', KeyType: 'HASH' }],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'status-index',
        KeySchema: [
          { AttributeName: 'status', KeyType: 'HASH' },
          { AttributeName: 'createdAt', KeyType: 'RANGE' }
        ],
        Projection: { ProjectionType: 'ALL' }
      }
    ]
  });

  await ensureTable({
    TableName: tableNames.idempotency,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [{ AttributeName: 'eventId', AttributeType: 'S' }],
    KeySchema: [{ AttributeName: 'eventId', KeyType: 'HASH' }]
  });

  await ensureTable({
    TableName: tableNames.rules,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [{ AttributeName: 'ruleId', AttributeType: 'S' }],
    KeySchema: [{ AttributeName: 'ruleId', KeyType: 'HASH' }]
  });

  await ensureTable({
    TableName: tableNames.notificationTargets,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'pk', AttributeType: 'S' },
      { AttributeName: 'sk', AttributeType: 'S' }
    ],
    KeySchema: [
      { AttributeName: 'pk', KeyType: 'HASH' },
      { AttributeName: 'sk', KeyType: 'RANGE' }
    ]
  });

  await ensureTable({
    TableName: tableNames.metrics,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'pk', AttributeType: 'S' },
      { AttributeName: 'sk', AttributeType: 'S' }
    ],
    KeySchema: [
      { AttributeName: 'pk', KeyType: 'HASH' },
      { AttributeName: 'sk', KeyType: 'RANGE' }
    ]
  });

  console.log('All tables ready.');
};

run().catch((error) => {
  console.error('Failed creating tables:', error);
  process.exit(1);
});
