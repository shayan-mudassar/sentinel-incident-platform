export {};

const send = jest.fn();
const info = jest.fn();
const error = jest.fn();

const listPendingOutbox = jest.fn();
const markOutboxPublished = jest.fn();

jest.mock('@sentinel/config', () => ({
  getConfig: () => ({
    outboxTableName: 'Outbox',
    eventBusName: 'bus'
  })
}));

jest.mock('@sentinel/aws', () => ({
  getEventBridgeClient: () => ({ send })
}));

jest.mock('@sentinel/logger', () => ({
  createLogger: () => ({ info, error })
}));

jest.mock('@sentinel/dynamodb', () => ({
  listPendingOutbox,
  markOutboxPublished
}));

const { handler } = require('../services/outbox-publisher/src/handler');

describe('outbox publisher', () => {
  beforeEach(() => {
    send.mockReset();
    info.mockReset();
    error.mockReset();
    listPendingOutbox.mockReset();
    markOutboxPublished.mockReset();
  });

  it('returns zero when no pending outbox items', async () => {
    listPendingOutbox.mockResolvedValueOnce([]);
    const response = await handler({}, { awsRequestId: 'req-1' } as never);
    expect(response.published).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('publishes pending outbox items', async () => {
    listPendingOutbox.mockResolvedValueOnce([
      {
        outboxId: 'o-1',
        eventType: 'IncidentChanged',
        source: 'sentinel.incident',
        detail: { incidentId: 'inc-1' }
      }
    ]);
    send.mockResolvedValueOnce({ FailedEntryCount: 0 });

    const response = await handler({}, { awsRequestId: 'req-2' } as never);

    expect(response.published).toBe(1);
    expect(markOutboxPublished).toHaveBeenCalledWith('Outbox', 'o-1');
  });

  it('skips marking when eventbridge reports failure', async () => {
    listPendingOutbox.mockResolvedValueOnce([
      {
        outboxId: 'o-2',
        eventType: 'IncidentChanged',
        source: 'sentinel.incident',
        detail: { incidentId: 'inc-2' }
      }
    ]);
    send.mockResolvedValueOnce({ FailedEntryCount: 1 });

    const response = await handler({}, { awsRequestId: 'req-3' } as never);

    expect(response.published).toBe(0);
    expect(markOutboxPublished).not.toHaveBeenCalled();
  });

  it('continues on publish error', async () => {
    listPendingOutbox.mockResolvedValueOnce([
      {
        outboxId: 'o-3',
        eventType: 'IncidentChanged',
        source: 'sentinel.incident',
        detail: { incidentId: 'inc-3' }
      }
    ]);
    send.mockRejectedValueOnce(new Error('boom'));

    const response = await handler({}, { awsRequestId: 'req-4' } as never);

    expect(response.published).toBe(0);
    expect(markOutboxPublished).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });
});
