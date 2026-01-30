import { describe, it, expect } from 'vitest';
import { factorialTool, FactorialInput } from '../src/tools/factorial.js';

describe('factorialTool', () => {
  it('should calculate factorial of 0', async () => {
    const result = await factorialTool({ n: 0 });

    expect(result.result).toBe(1);
    expect(result.operation).toBe('0! = 1');
  });

  it('should calculate factorial of 1', async () => {
    const result = await factorialTool({ n: 1 });

    expect(result.result).toBe(1);
    expect(result.operation).toBe('1! = 1');
  });

  it('should calculate factorial of 5', async () => {
    const result = await factorialTool({ n: 5 });

    expect(result.result).toBe(120);
    expect(result.operation).toBe('5! = 120');
  });

  it('should calculate factorial of 10', async () => {
    const result = await factorialTool({ n: 10 });

    expect(result.result).toBe(3628800);
    expect(result.operation).toBe('10! = 3628800');
  });

  it('should calculate factorial of a larger number', async () => {
    const result = await factorialTool({ n: 12 });

    expect(result.result).toBe(479001600);
    expect(result.operation).toBe('12! = 479001600');
  });
});

describe('FactorialInput schema', () => {
  it('should validate valid input', () => {
    const result = FactorialInput.safeParse({ n: 5 });
    expect(result.success).toBe(true);
  });

  it('should validate zero', () => {
    const result = FactorialInput.safeParse({ n: 0 });
    expect(result.success).toBe(true);
  });

  it('should reject negative numbers', () => {
    const result = FactorialInput.safeParse({ n: -5 });
    expect(result.success).toBe(false);
  });

  it('should reject decimal numbers', () => {
    const result = FactorialInput.safeParse({ n: 5.5 });
    expect(result.success).toBe(false);
  });

  it('should reject missing n parameter', () => {
    const result = FactorialInput.safeParse({});
    expect(result.success).toBe(false);
  });

  it('should reject non-number values', () => {
    const result = FactorialInput.safeParse({ n: 'not a number' });
    expect(result.success).toBe(false);
  });
});
