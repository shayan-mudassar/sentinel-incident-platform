import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { ingestEventSchema } from './event-schema';
import { IngestEvent } from '@sentinel/domain';

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validator = ajv.compile(ingestEventSchema);

type ValidationResult =
  | { valid: true; value: IngestEvent }
  | { valid: false; errors: string[] };

export const validateIngestEvent = (payload: unknown): ValidationResult => {
  const valid = validator(payload);
  if (valid) {
    return { valid: true, value: payload as IngestEvent };
  }

  const errors = (validator.errors || []).map((error) => {
    const path = error.instancePath || error.schemaPath;
    return `${path} ${error.message || 'is invalid'}`.trim();
  });

  return { valid: false, errors };
};
