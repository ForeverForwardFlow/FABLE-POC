import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  ValidationError,
  sanitizeError,
  validate,
  NonEmptyString,
  createMcpErrorResponse,
} from '../src/validation.js';

describe('sanitizeError', () => {
  it('should redact email addresses', () => {
    const result = sanitizeError('Error for user@example.com');
    expect(result).toBe('Error for [email]');
  });

  it('should redact bearer tokens', () => {
    const result = sanitizeError('Bearer abc123xyz');
    expect(result).toBe('Bearer [token]');
  });

  it('should redact access tokens in URLs', () => {
    const result = sanitizeError('url?access_token=secret123&foo=bar');
    expect(result).toBe('url?access_token=[redacted]&foo=bar');
  });

  it('should redact user paths', () => {
    const result = sanitizeError('File at /Users/john/docs/secret.txt');
    expect(result).toBe('File at /Users/[user]/docs/secret.txt');
  });

  it('should handle non-Error inputs', () => {
    const result = sanitizeError('plain string');
    expect(result).toBe('plain string');
  });
});

describe('validate', () => {
  it('should return validated data for valid input', () => {
    const schema = z.object({ name: NonEmptyString });
    const result = validate(schema, { name: 'test' });
    expect(result).toEqual({ name: 'test' });
  });

  it('should throw ValidationError for invalid input', () => {
    const schema = z.object({ name: NonEmptyString });
    expect(() => validate(schema, { name: '' })).toThrow(ValidationError);
  });

  it('should include field name in ValidationError', () => {
    const schema = z.object({ name: NonEmptyString });
    try {
      validate(schema, { name: '' });
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).field).toBe('name');
    }
  });
});

describe('createMcpErrorResponse', () => {
  it('should create standardized error response', () => {
    const result = createMcpErrorResponse(new Error('Test error'));
    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toBe('Test error');
  });

  it('should sanitize sensitive data in error', () => {
    const result = createMcpErrorResponse(new Error('Error for user@test.com'));
    expect(result.content[0].text).toBe('Error for [email]');
  });
});
