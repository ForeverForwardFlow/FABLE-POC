import { describe, it, expect } from 'vitest';
import { addTool, AddInput } from '../src/tools/add.js';

describe('addTool', () => {
  it('should add two positive numbers', async () => {
    const result = await addTool({ a: 5, b: 3 });

    expect(result.result).toBe(8);
    expect(result.operation).toBe('5 + 3 = 8');
  });

  it('should add negative numbers', async () => {
    const result = await addTool({ a: -5, b: -3 });

    expect(result.result).toBe(-8);
    expect(result.operation).toBe('-5 + -3 = -8');
  });

  it('should add positive and negative numbers', async () => {
    const result = await addTool({ a: 10, b: -7 });

    expect(result.result).toBe(3);
    expect(result.operation).toBe('10 + -7 = 3');
  });

  it('should add zero', async () => {
    const result = await addTool({ a: 5, b: 0 });

    expect(result.result).toBe(5);
    expect(result.operation).toBe('5 + 0 = 5');
  });

  it('should add decimal numbers', async () => {
    const result = await addTool({ a: 1.5, b: 2.3 });

    expect(result.result).toBeCloseTo(3.8);
    expect(result.operation).toBe('1.5 + 2.3 = 3.8');
  });

  it('should handle very large numbers', async () => {
    const result = await addTool({ a: 1e15, b: 1e15 });

    expect(result.result).toBe(2e15);
  });
});

describe('AddInput schema', () => {
  it('should validate valid input', () => {
    const result = AddInput.safeParse({ a: 1, b: 2 });
    expect(result.success).toBe(true);
  });

  it('should reject missing a parameter', () => {
    const result = AddInput.safeParse({ b: 2 });
    expect(result.success).toBe(false);
  });

  it('should reject missing b parameter', () => {
    const result = AddInput.safeParse({ a: 1 });
    expect(result.success).toBe(false);
  });

  it('should reject non-number values', () => {
    const result = AddInput.safeParse({ a: 'not a number', b: 2 });
    expect(result.success).toBe(false);
  });

  it('should reject missing parameters', () => {
    const result = AddInput.safeParse({});
    expect(result.success).toBe(false);
  });
});
