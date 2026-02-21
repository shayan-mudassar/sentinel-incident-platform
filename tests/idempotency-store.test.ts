export {};

const send = jest.fn();

jest.mock('@sentinel/aws', () => ({
  getDynamoDbDocClient: () => ({ send })
}));

describe('idempotency store', () => {
  beforeEach(() => {
    jest.resetModules();
    send.mockReset();
  });

  it('builds idempotency key', () => {
    const { buildIdempotencyKey } = require('../libs/idempotency/src');
    expect(buildIdempotencyKey('tenant-1', 'evt-1')).toBe('TENANT#tenant-1#EVENT#evt-1');
  });

  it('start succeeds on fresh event', async () => {
    send.mockResolvedValueOnce({});
    const { createIdempotencyStore } = require('../libs/idempotency/src');
    const store = createIdempotencyStore('Idempotency', 60);
    const result = await store.start('evt-1', { tenantId: 'tenant-1' });
    expect(result.started).toBe(true);
    const command = send.mock.calls[0][0];
    expect(command.input.TableName).toBe('Idempotency');
    expect(command.input.Item.eventId).toBe('evt-1');
  });

  it('start returns existing record on conflict', async () => {
    send
      .mockRejectedValueOnce(new Error('exists'))
      .mockResolvedValueOnce({ Item: { eventId: 'evt-2', status: 'COMPLETED' } });
    const { createIdempotencyStore } = require('../libs/idempotency/src');
    const store = createIdempotencyStore('Idempotency', 60);
    const result = await store.start('evt-2');
    expect(result.started).toBe(false);
    expect(result.record?.status).toBe('COMPLETED');
  });

  it('complete updates record', async () => {
    send.mockResolvedValueOnce({});
    const { createIdempotencyStore } = require('../libs/idempotency/src');
    const store = createIdempotencyStore('Idempotency', 60);
    await store.complete('evt-3', { ok: true });
    const command = send.mock.calls[0][0];
    expect(command.input.Key).toEqual({ eventId: 'evt-3' });
    expect(command.input.ExpressionAttributeValues[':status']).toBe('COMPLETED');
  });

  it('fail updates record with reason', async () => {
    send.mockResolvedValueOnce({});
    const { createIdempotencyStore } = require('../libs/idempotency/src');
    const store = createIdempotencyStore('Idempotency', 60);
    await store.fail('evt-4', 'boom');
    const command = send.mock.calls[0][0];
    expect(command.input.ExpressionAttributeValues[':status']).toBe('FAILED');
    expect(command.input.ExpressionAttributeValues[':response']).toEqual({ reason: 'boom' });
  });
});
