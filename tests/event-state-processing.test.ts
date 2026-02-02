import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { startEventProcessing } from '@sentinel/dynamodb';

const send = jest.fn();

jest.mock('@sentinel/aws', () => ({
  getDynamoDbDocClient: () => ({ send })
}));

describe('startEventProcessing', () => {
  beforeEach(() => {
    send.mockReset();
  });

  it('returns duplicate when record is already processed', async () => {
    const condErr = Object.assign(new Error('conditional'), {
      name: 'ConditionalCheckFailedException'
    });

    send.mockImplementation((command: unknown) => {
      if (command instanceof PutCommand) {
        return Promise.reject(condErr);
      }
      if (command instanceof GetCommand) {
        return Promise.resolve({ Item: { status: 'PROCESSED', updatedAt: new Date().toISOString() } });
      }
      return Promise.resolve({});
    });

    const result = await startEventProcessing('table', 'evt-1', 300, 60);
    expect(result.status).toBe('duplicate');
  });

  it('throws on non-conditional errors', async () => {
    const err = Object.assign(new Error('boom'), {
      name: 'ProvisionedThroughputExceededException'
    });

    send.mockImplementation((command: unknown) => {
      if (command instanceof PutCommand) {
        return Promise.reject(err);
      }
      return Promise.resolve({});
    });

    await expect(startEventProcessing('table', 'evt-2', 300, 60)).rejects.toThrow('boom');
  });

  it('returns in_progress when processing lock is recent', async () => {
    const condErr = Object.assign(new Error('conditional'), {
      name: 'ConditionalCheckFailedException'
    });

    send.mockImplementation((command: unknown) => {
      if (command instanceof PutCommand) {
        return Promise.reject(condErr);
      }
      if (command instanceof GetCommand) {
        return Promise.resolve({ Item: { status: 'PROCESSING', updatedAt: new Date().toISOString() } });
      }
      if (command instanceof UpdateCommand) {
        return Promise.reject(condErr);
      }
      return Promise.resolve({});
    });

    const result = await startEventProcessing('table', 'evt-3', 300, 300);
    expect(result.status).toBe('in_progress');
  });
});
