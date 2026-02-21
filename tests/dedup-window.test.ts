import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { updateDedupState } from '@sentinel/dynamodb';

const send = jest.fn();

jest.mock('@sentinel/aws', () => ({
  getDynamoDbDocClient: () => ({ send })
}));

describe('dedup window behavior', () => {
  beforeEach(() => {
    send.mockReset();
  });

  it('suppresses duplicates within the window', async () => {
    const now = Date.now();
    let state: { windowStart?: number; count?: number } | undefined;

    send.mockImplementation((command: unknown) => {
      if (command instanceof GetCommand) {
        return Promise.resolve({ Item: state });
      }
      if (command instanceof UpdateCommand) {
        if (!state || !state.windowStart) {
          state = { windowStart: now, count: 1 };
        } else {
          state = { windowStart: state.windowStart, count: (state.count || 0) + 1 };
        }
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });

    const first = await updateDedupState(
      'EventState',
      'tenant-1',
      'prod',
      'service-a',
      'fp',
      60000,
      300
    );
    const second = await updateDedupState(
      'EventState',
      'tenant-1',
      'prod',
      'service-a',
      'fp',
      60000,
      300
    );

    expect(first.suppressed).toBe(false);
    expect(second.suppressed).toBe(true);
  });
});
