import { describe, it, expect } from 'vitest';
import { countWordsTool, CountWordsInput } from '../src/tools/count_words.js';

describe('countWordsTool', () => {
  it('should count words in a simple sentence', async () => {
    const result = await countWordsTool({ text: 'Hello world' });

    expect(result.wordCount).toBe(2);
    expect(result.characterCount).toBe(11);
    expect(result.characterCountNoSpaces).toBe(10);
  });

  it('should handle a single word', async () => {
    const result = await countWordsTool({ text: 'Hello' });

    expect(result.wordCount).toBe(1);
    expect(result.characterCount).toBe(5);
    expect(result.characterCountNoSpaces).toBe(5);
  });

  it('should handle empty string', async () => {
    const result = await countWordsTool({ text: '' });

    expect(result.wordCount).toBe(0);
    expect(result.characterCount).toBe(0);
    expect(result.characterCountNoSpaces).toBe(0);
  });

  it('should handle whitespace-only string', async () => {
    const result = await countWordsTool({ text: '   ' });

    expect(result.wordCount).toBe(0);
    expect(result.characterCount).toBe(3);
    expect(result.characterCountNoSpaces).toBe(0);
  });

  it('should handle multiple spaces between words', async () => {
    const result = await countWordsTool({ text: 'Hello    world' });

    expect(result.wordCount).toBe(2);
    expect(result.characterCount).toBe(14);
    expect(result.characterCountNoSpaces).toBe(10);
  });

  it('should handle text with newlines and tabs', async () => {
    const result = await countWordsTool({ text: 'Hello\nworld\there' });

    expect(result.wordCount).toBe(3);
    expect(result.characterCountNoSpaces).toBe(14);
  });

  it('should return the original text', async () => {
    const text = 'Test input text';
    const result = await countWordsTool({ text });

    expect(result.text).toBe(text);
  });
});

describe('CountWordsInput schema', () => {
  it('should validate valid input', () => {
    const result = CountWordsInput.safeParse({ text: 'test' });
    expect(result.success).toBe(true);
  });

  it('should accept empty string', () => {
    const result = CountWordsInput.safeParse({ text: '' });
    expect(result.success).toBe(true);
  });

  it('should reject missing text', () => {
    const result = CountWordsInput.safeParse({});
    expect(result.success).toBe(false);
  });

  it('should reject non-string text', () => {
    const result = CountWordsInput.safeParse({ text: 123 });
    expect(result.success).toBe(false);
  });
});
