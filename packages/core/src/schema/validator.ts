import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

const checkpointSchema = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Claude Relay Checkpoint",
  "type": "object",
  "properties": {
    "schemaVersion": { "type": "string", "enum": ["1.0"] },
    "id": { "type": "string" },
    "createdAt": { "type": "string", "format": "date-time" },
    "type": { "type": "string", "enum": ["lightweight", "recovery"] },
    "reason": { "type": "string" },
    "workspace": {
      "type": "object",
      "properties": {
        "path": { "type": "string" },
        "name": { "type": "string" }
      },
      "required": ["path"]
    },
    "git": {
      "type": "object",
      "properties": {
        "branch": { "type": "string" },
        "head": { "type": "string" },
        "isDetached": { "type": "boolean" },
        "isDirty": { "type": "boolean" },
        "staged": { "type": "array", "items": { "type": "string" } },
        "unstaged": { "type": "array", "items": { "type": "string" } },
        "untracked": { "type": "array", "items": { "type": "string" } }
      },
      "required": ["branch", "head", "isDirty"]
    },
    "usage": {
      "type": "object",
      "properties": {
        "contextPercent": { "type": ["number", "null"] },
        "fiveHourPercent": { "type": ["number", "null"] },
        "provider": { "type": "string" }
      }
    }
  },
  "required": ["schemaVersion", "id", "createdAt", "type", "reason", "workspace", "git"]
};

const handoffSchema = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Claude Relay Handoff",
  "type": "object",
  "properties": {
    "schemaVersion": { "type": "string", "enum": ["1.0"] },
    "id": { "type": "string" },
    "createdAt": { "type": "string", "format": "date-time" },
    "reason": { "type": "string" },
    "workspace": {
      "type": "object",
      "properties": {
        "path": { "type": "string" },
        "name": { "type": "string" }
      },
      "required": ["path"]
    },
    "git": {
      "type": "object",
      "properties": {
        "branch": { "type": "string" },
        "head": { "type": "string" },
        "isDetached": { "type": "boolean" },
        "isDirty": { "type": "boolean" }
      },
      "required": ["branch", "head", "isDirty"]
    },
    "semantic": {
      "type": "object",
      "properties": {
        "objective": { "type": "string" },
        "nextAction": { "type": "string" }
      },
      "required": ["objective", "nextAction"]
    },
    "integrity": {
      "type": "object",
      "properties": {
        "hash": { "type": "string" }
      },
      "required": ["hash"]
    }
  },
  "required": ["schemaVersion", "id", "createdAt", "reason", "workspace", "git", "semantic", "integrity"]
};

const validateCheckpointAjv = ajv.compile(checkpointSchema);
const validateHandoffAjv = ajv.compile(handoffSchema);

export class SchemaValidator {
  static validateCheckpoint(data: any): boolean {
    return validateCheckpointAjv(data) as boolean;
  }

  static validateHandoff(data: any): boolean {
    return validateHandoffAjv(data) as boolean;
  }
}
