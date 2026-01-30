import { describe, it, expect } from 'vitest';
import { uppercaseTool, UppercaseInput } from '../src/tools/uppercase.js';

describe('uppercaseTool', () => {
  it('should convert a simple string to uppercase', async () => {
    const result = await uppercaseTool({ text: 'hello' });

    expect(result.original).toBe('hello');
    expect(result.uppercase).toBe('HELLO');
    expect(result.length).toBe(5);
  });

  it('should convert a string with spaces to uppercase', async () => {
    const result = await uppercaseTool({ text: 'hello world' });

    expect(result.original).toBe('hello world');
    expect(result.uppercase).toBe('HELLO WORLD');
    expect(result.length).toBe(11);
  });

  it('should handle single character', async () => {
    const result = await uppercaseTool({ text: 'a' });

    expect(result.original).toBe('a');
    expect(result.uppercase).toBe('A');
    expect(result.length).toBe(1);
  });

  it('should handle already uppercase strings', async () => {
    const result = await uppercaseTool({ text: 'HELLO' });

    expect(result.original).toBe('HELLO');
    expect(result.uppercase).toBe('HELLO');
    expect(result.length).toBe(5);
  });

  it('should handle mixed case strings', async () => {
    const result = await uppercaseTool({ text: 'HeLLo WoRLd' });

    expect(result.original).toBe('HeLLo WoRLd');
    expect(result.uppercase).toBe('HELLO WORLD');
    expect(result.length).toBe(11);
  });

  it('should handle special characters', async () => {
    const result = await uppercaseTool({ text: 'abc!@#' });

    expect(result.original).toBe('abc!@#');
    expect(result.uppercase).toBe('ABC!@#');
    expect(result.length).toBe(6);
  });
});

describe('UppercaseInput schema', () => {
  it('should validate valid input', () => {
    const result = UppercaseInput.safeParse({ text: 'test' });
    expect(result.success).toBe(true);
  });

  it('should reject empty text', () => {
    const result = UppercaseInput.safeParse({ text: '' });
    expect(result.success).toBe(false);
  });

  it('should reject missing text', () => {
    const result = UppercaseInput.safeParse({});
    expect(result.success).toBe(false);
  });
});
