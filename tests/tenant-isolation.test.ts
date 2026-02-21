import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { listIncidents } from '@sentinel/dynamodb';

const send = jest.fn();

jest.mock('@sentinel/aws', () => ({
  getDynamoDbDocClient: () => ({ send })
}));

describe('tenant isolation', () => {
  beforeEach(() => {
    send.mockReset();
  });

  it('scopes incident list queries by tenant', async () => {
    send.mockImplementation((command: unknown) => {
      if (command instanceof QueryCommand) {
        expect(command.input.ExpressionAttributeValues?.[':pk']).toBe('TENANT#tenant-a#STATUS#OPEN');
        return Promise.resolve({ Items: [] });
      }
      return Promise.resolve({});
    });

    const result = await listIncidents('Incidents', {
      tenantId: 'tenant-a',
      status: 'OPEN'
    });

    expect(result.items).toEqual([]);
  });
});
