import { describe, it, expect } from 'vitest';
import { SecretRedactor } from '../src/security/redactor';

describe('SecretRedactor', () => {
  it('redacts Anthropic API keys', () => {
    const input = 'My key is sk-ant-api03-12345678901234567890123456789012345678901234567890';
    const output = SecretRedactor.redact(input);
    expect(output).toContain('[REDACTED_SECRET]');
    expect(output).not.toContain('sk-ant-api03-');
  });

  it('redacts Github tokens', () => {
    const input = 'ghp_abcdefghijklmnopqrstuvwxyz1234567890 is my token';
    const output = SecretRedactor.redact(input);
    expect(output).toContain('[REDACTED_SECRET]');
    expect(output).not.toContain('ghp_abcdef');
  });

  it('leaves safe text alone', () => {
    const input = 'this is a normal string with no secrets';
    const output = SecretRedactor.redact(input);
    expect(output).toBe(input);
  });
});
