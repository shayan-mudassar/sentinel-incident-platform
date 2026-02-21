export {};

const send = jest.fn();

jest.mock('@sentinel/aws', () => ({
  getDynamoDbDocClient: () => ({ send })
}));

describe('dynamodb helpers', () => {
  beforeEach(() => {
    jest.resetModules();
    send.mockReset();
  });

  it('records incident events with tenant key', async () => {
    send.mockResolvedValueOnce({});
    const { recordIncidentEvent } = require('../libs/dynamodb/src/incident-events');
    await recordIncidentEvent(
      'IncidentEvents',
      'tenant-1',
      'inc-1',
      {
        eventId: 'evt-1',
        source: 'svc',
        type: 'error',
        timestamp: '2024-01-01T00:00:00.000Z',
        fingerprint: 'fp',
        attributes: {}
      },
      60
    );
    const command = send.mock.calls[0][0];
    expect(command.input.Item.pk).toBe('TENANT#tenant-1#INCIDENT#inc-1');
    expect(command.input.Item.sk).toContain('EVENT#');
  });

  it('lists incident events with correct key prefix', async () => {
    send.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });
    const { listIncidentEvents } = require('../libs/dynamodb/src/incident-events');
    await listIncidentEvents('IncidentEvents', { tenantId: 'tenant-1', incidentId: 'inc-1', limit: 10 });
    const command = send.mock.calls[0][0];
    expect(command.input.ExpressionAttributeValues[':pk']).toBe('TENANT#tenant-1#INCIDENT#inc-1');
    expect(command.input.ExpressionAttributeValues[':sk']).toBe('EVENT#');
  });

  it('putOutboxEvent and listPendingOutbox use correct status', async () => {
    send.mockResolvedValueOnce({}).mockResolvedValueOnce({ Items: [] });
    const { putOutboxEvent, listPendingOutbox } = require('../libs/dynamodb/src/outbox');
    await putOutboxEvent('Outbox', {
      outboxId: 'o1',
      status: 'PENDING',
      eventType: 'IncidentChanged',
      source: 'sentinel',
      detail: { foo: 'bar' },
      createdAt: '2024-01-01T00:00:00.000Z',
      expiresAt: 1
    });
    await listPendingOutbox('Outbox', 5);
    const listCommand = send.mock.calls[1][0];
    expect(listCommand.input.ExpressionAttributeValues[':status']).toBe('PENDING');
  });

  it('incrementTenantMetric updates count', async () => {
    send.mockResolvedValueOnce({});
    const { incrementTenantMetric } = require('../libs/dynamodb/src/metrics');
    await incrementTenantMetric('Metrics', 'tenant-1', 'ingested_total', 2);
    const command = send.mock.calls[0][0];
    expect(command.input.ExpressionAttributeValues[':inc']).toBe(2);
  });

  it('getTenantMetrics returns defaults for missing items', async () => {
    send.mockResolvedValueOnce({ Responses: {} });
    const { getTenantMetrics } = require('../libs/dynamodb/src/metrics');
    const metrics = await getTenantMetrics('Metrics', 'tenant-1', ['ingested_total', 'deduped_total']);
    expect(metrics.ingested_total.count).toBe(0);
    expect(metrics.deduped_total.count).toBe(0);
  });

  it('getNotificationTargets falls back to ALL severity', async () => {
    send
      .mockResolvedValueOnce({ Item: { tenantId: 'tenant-1', severity: 'high', targets: [] } })
      .mockResolvedValueOnce({
        Item: {
          tenantId: 'tenant-1',
          severity: 'ALL',
          targets: [{ type: 'SNS', topicArn: 'arn:aws:sns:us-east-1:1:topic' }]
        }
      });
    const { getNotificationTargets } = require('../libs/dynamodb/src/notification-targets');
    const targets = await getNotificationTargets('NotificationTargets', 'tenant-1', 'high');
    expect(targets).toHaveLength(1);
    expect(targets[0].topicArn).toContain('topic');
  });
});
