export {};

jest.mock('aws-xray-sdk-core', () => ({
  captureAWSv3Client: () => {
    throw new Error('xray disabled');
  }
}));

describe('aws client helpers', () => {
  it('returns cached clients even if xray capture fails', () => {
    const {
      getDynamoDbClient,
      getEventBridgeClient,
      getSqsClient,
      getCloudWatchClient,
      getSnsClient
    } = require('../libs/aws/src');

    const ddb = getDynamoDbClient();
    const ddb2 = getDynamoDbClient();
    expect(ddb).toBe(ddb2);

    expect(getEventBridgeClient()).toBe(getEventBridgeClient());
    expect(getSqsClient()).toBe(getSqsClient());
    expect(getCloudWatchClient()).toBe(getCloudWatchClient());
    expect(getSnsClient()).toBe(getSnsClient());
  });
});
