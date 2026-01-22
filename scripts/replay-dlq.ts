import { ReceiveMessageCommand, DeleteMessageCommand, SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

const args = process.argv.slice(2);
const getArg = (name: string, fallback?: string) => {
  const index = args.findIndex((arg) => arg === name);
  if (index >= 0 && args[index + 1]) {
    return args[index + 1];
  }
  return fallback;
};

const hasFlag = (name: string) => args.includes(name);

const dlqUrl = getArg('--dlq-url', process.env.DLQ_URL || '');
const targetQueueUrl = getArg('--target-queue-url', process.env.TARGET_QUEUE_URL || '');
const eventBusName = getArg('--event-bus', process.env.EVENT_BUS_NAME || '');
const requeueTo = getArg('--requeue-to', 'queue');
const dryRun = hasFlag('--dry-run');
const maxMessages = Number(getArg('--max', '10'));
const force = hasFlag('--force');

if (!dlqUrl) {
  console.error('Missing --dlq-url or DLQ_URL');
  process.exit(1);
}

if (requeueTo === 'queue' && !targetQueueUrl) {
  console.error('Missing --target-queue-url or TARGET_QUEUE_URL');
  process.exit(1);
}

if (requeueTo === 'eventbridge' && !eventBusName) {
  console.error('Missing --event-bus or EVENT_BUS_NAME');
  process.exit(1);
}

const sqsClient = new SQSClient({});
const eventBridgeClient = new EventBridgeClient({});

const shouldSkip = (detail: Record<string, unknown>) => {
  if (force) {
    return false;
  }
  if (detail.replayed === true) {
    return true;
  }
  const count = typeof detail.replayCount === 'number' ? detail.replayCount : 0;
  return count >= 3;
};

const bumpReplay = (detail: Record<string, unknown>) => {
  const count = typeof detail.replayCount === 'number' ? detail.replayCount : 0;
  return {
    ...detail,
    replayed: true,
    replayCount: count + 1
  };
};

const requeueMessage = async (body: string) => {
  const parsed = JSON.parse(body);
  const detail = parsed.detail || {};

  if (shouldSkip(detail)) {
    return { skipped: true };
  }

  const updatedDetail = bumpReplay(detail);
  const updatedBody = JSON.stringify({ ...parsed, detail: updatedDetail });

  if (dryRun) {
    return { skipped: false, dryRun: true };
  }

  if (requeueTo === 'queue') {
    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: targetQueueUrl,
        MessageBody: updatedBody
      })
    );
  } else {
    await eventBridgeClient.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: eventBusName,
            Source: parsed.source || 'sentinel.replay',
            DetailType: parsed['detail-type'] || 'Replay',
            Detail: JSON.stringify(updatedDetail)
          }
        ]
      })
    );
  }

  return { skipped: false, dryRun: false };
};

const run = async () => {
  let processed = 0;
  while (processed < maxMessages) {
    const response = await sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: dlqUrl,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 1
      })
    );

    if (!response.Messages || response.Messages.length === 0) {
      break;
    }

    const message = response.Messages[0];
    if (!message.Body || !message.ReceiptHandle) {
      break;
    }

    const result = await requeueMessage(message.Body);
    if (!result.skipped && !result.dryRun) {
      await sqsClient.send(
        new DeleteMessageCommand({
          QueueUrl: dlqUrl,
          ReceiptHandle: message.ReceiptHandle
        })
      );
    }

    processed += 1;
    console.log({ processed, ...result });
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
