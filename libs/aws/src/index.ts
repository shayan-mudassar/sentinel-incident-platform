import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { SQSClient } from '@aws-sdk/client-sqs';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { SNSClient } from '@aws-sdk/client-sns';
import AWSXRay from 'aws-xray-sdk-core';

const capture = <T extends object>(client: T): T => {
  try {
    return AWSXRay.captureAWSv3Client(client as never) as T;
  } catch {
    return client;
  }
};

let ddbClient: DynamoDBClient | undefined;
let docClient: DynamoDBDocumentClient | undefined;
let eventBridgeClient: EventBridgeClient | undefined;
let sqsClient: SQSClient | undefined;
let cloudWatchClient: CloudWatchClient | undefined;
let snsClient: SNSClient | undefined;

export const getDynamoDbClient = (): DynamoDBClient => {
  if (!ddbClient) {
    ddbClient = capture(new DynamoDBClient({}));
  }
  return ddbClient;
};

export const getDynamoDbDocClient = (): DynamoDBDocumentClient => {
  if (!docClient) {
    docClient = DynamoDBDocumentClient.from(getDynamoDbClient());
  }
  return docClient;
};

export const getEventBridgeClient = (): EventBridgeClient => {
  if (!eventBridgeClient) {
    eventBridgeClient = capture(new EventBridgeClient({}));
  }
  return eventBridgeClient;
};

export const getSqsClient = (): SQSClient => {
  if (!sqsClient) {
    sqsClient = capture(new SQSClient({}));
  }
  return sqsClient;
};

export const getCloudWatchClient = (): CloudWatchClient => {
  if (!cloudWatchClient) {
    cloudWatchClient = capture(new CloudWatchClient({}));
  }
  return cloudWatchClient;
};

export const getSnsClient = (): SNSClient => {
  if (!snsClient) {
    snsClient = capture(new SNSClient({}));
  }
  return snsClient;
};
