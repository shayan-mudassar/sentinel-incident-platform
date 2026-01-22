export const ingestEventSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['eventId', 'source', 'type', 'timestamp', 'fingerprint', 'attributes'],
  properties: {
    eventId: { type: 'string', minLength: 1 },
    source: { type: 'string', minLength: 1 },
    type: { type: 'string', minLength: 1 },
    severityHint: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
    timestamp: { type: 'string', format: 'date-time' },
    fingerprint: { type: 'string', minLength: 1 },
    attributes: { type: 'object', additionalProperties: true }
  }
} as const;
