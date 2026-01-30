import { describe, it, expect } from 'vitest';
import { multiplyTool, MultiplyInput } from '../src/tools/multiply.js';

describe('multiplyTool', () => {
  it('should multiply two positive numbers', async () => {
    const result = await multiplyTool({ a: 5, b: 3 });

    expect(result.result).toBe(15);
    expect(result.operation).toBe('5 × 3 = 15');
  });

  it('should multiply negative numbers', async () => {
    const result = await multiplyTool({ a: -5, b: -3 });

    expect(result.result).toBe(15);
    expect(result.operation).toBe('-5 × -3 = 15');
  });

  it('should multiply positive and negative numbers', async () => {
    const result = await multiplyTool({ a: 10, b: -7 });

    expect(result.result).toBe(-70);
    expect(result.operation).toBe('10 × -7 = -70');
  });

  it('should multiply by zero', async () => {
    const result = await multiplyTool({ a: 5, b: 0 });

    expect(result.result).toBe(0);
    expect(result.operation).toBe('5 × 0 = 0');
  });

  it('should multiply decimal numbers', async () => {
    const result = await multiplyTool({ a: 1.5, b: 2.5 });

    expect(result.result).toBeCloseTo(3.75);
    expect(result.operation).toBe('1.5 × 2.5 = 3.75');
  });

  it('should handle very large numbers', async () => {
    const result = await multiplyTool({ a: 1e10, b: 1e5 });

    expect(result.result).toBe(1e15);
  });

  it('should multiply by one', async () => {
    const result = await multiplyTool({ a: 42, b: 1 });

    expect(result.result).toBe(42);
    expect(result.operation).toBe('42 × 1 = 42');
  });
});

describe('MultiplyInput schema', () => {
  it('should validate valid input', () => {
    const result = MultiplyInput.safeParse({ a: 1, b: 2 });
    expect(result.success).toBe(true);
  });

  it('should reject missing a parameter', () => {
    const result = MultiplyInput.safeParse({ b: 2 });
    expect(result.success).toBe(false);
  });

  it('should reject missing b parameter', () => {
    const result = MultiplyInput.safeParse({ a: 1 });
    expect(result.success).toBe(false);
  });

  it('should reject non-number values', () => {
    const result = MultiplyInput.safeParse({ a: 'not a number', b: 2 });
    expect(result.success).toBe(false);
  });

  it('should reject missing parameters', () => {
    const result = MultiplyInput.safeParse({});
    expect(result.success).toBe(false);
  });
});
