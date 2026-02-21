export {};

const send = jest.fn();
const info = jest.fn();
const warn = jest.fn();
const error = jest.fn();

jest.mock('@sentinel/aws', () => ({
  getSnsClient: () => ({ send })
}));

jest.mock('@sentinel/config', () => ({
  getConfig: () => ({
    notificationTargetsTableName: 'NotificationTargets'
  })
}));

jest.mock('@sentinel/logger', () => ({
  createLogger: () => ({ info, warn, error })
}));

jest.mock('@sentinel/dynamodb', () => ({
  getNotificationTargets: jest.fn()
}));

const { getNotificationTargets } = require('@sentinel/dynamodb');
const { handler } = require('../services/notification-worker/src/handler');

const makeEvent = (detail: Record<string, unknown>) => ({
  Records: [
    {
      messageId: 'msg-1',
      body: JSON.stringify({ detail })
    }
  ]
});

describe('notification worker', () => {
  beforeEach(() => {
    send.mockReset();
    info.mockReset();
    warn.mockReset();
    error.mockReset();
    getNotificationTargets.mockReset();
    delete process.env.DEFAULT_NOTIFICATION_TOPIC_ARN;
  });

  it('fails when tenantId is missing', async () => {
    const response = await handler(makeEvent({ severity: 'high' }) as never, { awsRequestId: 'r1' } as never);
    expect(response.batchItemFailures).toHaveLength(1);
  });

  it('fails when severity is missing', async () => {
    const response = await handler(makeEvent({ tenantId: 'tenant-1' }) as never, { awsRequestId: 'r1' } as never);
    expect(response.batchItemFailures).toHaveLength(1);
  });

  it('uses default topic when no targets configured', async () => {
    process.env.DEFAULT_NOTIFICATION_TOPIC_ARN = 'arn:aws:sns:us-east-1:1:default';
    getNotificationTargets.mockResolvedValueOnce([]);
    await handler(
      makeEvent({ tenantId: 'tenant-1', severity: 'high', source: 'svc', changeType: 'OPENED' }) as never,
      { awsRequestId: 'r1' } as never
    );
    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0];
    expect(command.input.TopicArn).toBe('arn:aws:sns:us-east-1:1:default');
  });

  it('sends to configured targets', async () => {
    getNotificationTargets.mockResolvedValueOnce([
      { type: 'SNS', topicArn: 'arn:aws:sns:us-east-1:1:topic1' },
      { type: 'SNS', topicArn: 'arn:aws:sns:us-east-1:1:topic2' }
    ]);
    await handler(
      makeEvent({ tenantId: 'tenant-1', severity: 'high', source: 'svc', changeType: 'OPENED' }) as never,
      { awsRequestId: 'r1' } as never
    );
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('skips when no targets and no default topic', async () => {
    getNotificationTargets.mockResolvedValueOnce([]);
    const response = await handler(
      makeEvent({ tenantId: 'tenant-1', severity: 'high', source: 'svc', changeType: 'OPENED' }) as never,
      { awsRequestId: 'r1' } as never
    );
    expect(send).not.toHaveBeenCalled();
    expect(response.batchItemFailures).toHaveLength(0);
  });
});
