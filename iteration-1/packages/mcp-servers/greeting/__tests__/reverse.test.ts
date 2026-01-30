import { describe, it, expect } from 'vitest';
import { reverseTool, ReverseInput } from '../src/tools/reverse.js';

describe('reverseTool', () => {
  it('should reverse a simple string', async () => {
    const result = await reverseTool({ text: 'hello' });

    expect(result.original).toBe('hello');
    expect(result.reversed).toBe('olleh');
    expect(result.length).toBe(5);
  });

  it('should reverse a string with spaces', async () => {
    const result = await reverseTool({ text: 'hello world' });

    expect(result.original).toBe('hello world');
    expect(result.reversed).toBe('dlrow olleh');
    expect(result.length).toBe(11);
  });

  it('should handle single character', async () => {
    const result = await reverseTool({ text: 'a' });

    expect(result.original).toBe('a');
    expect(result.reversed).toBe('a');
    expect(result.length).toBe(1);
  });

  it('should handle palindromes', async () => {
    const result = await reverseTool({ text: 'racecar' });

    expect(result.original).toBe('racecar');
    expect(result.reversed).toBe('racecar');
    expect(result.length).toBe(7);
  });

  it('should handle special characters', async () => {
    const result = await reverseTool({ text: 'abc!@#' });

    expect(result.original).toBe('abc!@#');
    expect(result.reversed).toBe('#@!cba');
    expect(result.length).toBe(6);
  });
});

describe('ReverseInput schema', () => {
  it('should validate valid input', () => {
    const result = ReverseInput.safeParse({ text: 'test' });
    expect(result.success).toBe(true);
  });

  it('should reject empty text', () => {
    const result = ReverseInput.safeParse({ text: '' });
    expect(result.success).toBe(false);
  });

  it('should reject missing text', () => {
    const result = ReverseInput.safeParse({});
    expect(result.success).toBe(false);
  });
});
