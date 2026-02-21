export {};

const send = jest.fn();

jest.mock('@sentinel/aws', () => ({
  getDynamoDbDocClient: () => ({ send })
}));

describe('dynamodb incidents', () => {
  beforeEach(() => {
    jest.resetModules();
    send.mockReset();
  });

  it('buildIncidentKey formats tenant-scoped key', () => {
    const { buildIncidentKey } = require('../libs/dynamodb/src/incidents');
    expect(buildIncidentKey('t1', 'prod', 'svc', 'fp')).toBe('TENANT#t1#INCIDENTKEY#prod#svc#fp');
  });

  it('listIncidents builds query with filters', async () => {
    send.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: { pk: 'x' } });
    const { listIncidents } = require('../libs/dynamodb/src/incidents');
    await listIncidents('Incidents', {
      tenantId: 'tenant-1',
      status: 'OPEN',
      source: 'svc',
      env: 'prod',
      severity: 'high',
      from: '2024-01-01T00:00:00.000Z',
      to: '2024-01-02T00:00:00.000Z',
      limit: 10,
      nextToken: { pk: 'n' }
    });
    const command = send.mock.calls[0][0];
    expect(command.input.IndexName).toBe('status-index');
    expect(command.input.FilterExpression).toContain('severity = :severity');
    expect(command.input.FilterExpression).toContain('env = :env');
    expect(command.input.FilterExpression).toContain('updatedAt >= :from');
    expect(command.input.FilterExpression).toContain('updatedAt <= :to');
    expect(command.input.ExpressionAttributeValues[':pk']).toBe('TENANT#tenant-1#STATUS#OPEN');
  });

  it('createIncident uses transaction with pointer and state', async () => {
    send.mockResolvedValueOnce({});
    const { createIncident } = require('../libs/dynamodb/src/incidents');
    const incident = {
      incidentId: 'inc-1',
      tenantId: 'tenant-1',
      status: 'OPEN',
      source: 'svc',
      fingerprint: 'fp',
      env: 'prod',
      severity: 'low',
      openedAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      lastEventAt: '2024-01-01T00:00:00.000Z',
      eventCount: 1,
      version: 1
    };
    await createIncident('Incidents', 'tenant-1', incident, 'prod', 'svc', 'fp');
    const command = send.mock.calls[0][0];
    expect(command.input.TransactItems).toHaveLength(3);
    expect(command.input.TransactItems[1].Put.Item.pk).toContain('TENANT#tenant-1#INCIDENT#inc-1');
    expect(command.input.TransactItems[2].Put.Item.pk).toContain('TENANT#tenant-1#INCIDENTKEY#prod#svc#fp');
  });

  it('updateIncident enforces version condition', async () => {
    send.mockResolvedValueOnce({});
    const { updateIncident } = require('../libs/dynamodb/src/incidents');
    await updateIncident(
      'Incidents',
      'tenant-1',
      'inc-1',
      {
        status: 'OPEN',
        severity: 'high',
        lastEventAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:01.000Z',
        eventCount: 2,
        version: 2,
        source: 'svc',
        env: 'prod'
      },
      1
    );
    const command = send.mock.calls[0][0];
    expect(command.input.ConditionExpression).toBe('version = :expected');
    expect(command.input.ExpressionAttributeValues[':expected']).toBe(1);
  });

  it('updateActivePointer and deleteActivePointer issue commands', async () => {
    send.mockResolvedValue({});
    const { updateActivePointer, deleteActivePointer } = require('../libs/dynamodb/src/incidents');
    await updateActivePointer('Incidents', 'tenant-1', 'prod', 'svc', 'fp', 'OPEN');
    await deleteActivePointer('Incidents', 'tenant-1', 'prod', 'svc', 'fp');
    const updateCommand = send.mock.calls[0][0];
    const deleteCommand = send.mock.calls[1][0];
    expect(updateCommand.input.Key.pk).toContain('TENANT#tenant-1#INCIDENTKEY#prod#svc#fp');
    expect(deleteCommand.input.Key.sk).toBe('ACTIVE');
  });
});
