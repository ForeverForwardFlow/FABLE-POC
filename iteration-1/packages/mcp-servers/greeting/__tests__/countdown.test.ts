import { describe, it, expect } from 'vitest';
import { countdownTool, CountdownInput } from '../src/tools/countdown.js';

describe('countdownTool', () => {
  it('should count down from 5 to 0', async () => {
    const result = await countdownTool({ start: 5 });

    expect(result.countdown).toEqual([5, 4, 3, 2, 1, 0]);
    expect(result.start).toBe(5);
    expect(result.count).toBe(6);
  });

  it('should count down from 1 to 0', async () => {
    const result = await countdownTool({ start: 1 });

    expect(result.countdown).toEqual([1, 0]);
    expect(result.start).toBe(1);
    expect(result.count).toBe(2);
  });

  it('should handle countdown from 10', async () => {
    const result = await countdownTool({ start: 10 });

    expect(result.countdown).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
    expect(result.start).toBe(10);
    expect(result.count).toBe(11);
  });

  it('should include correct count', async () => {
    const result = await countdownTool({ start: 3 });

    expect(result.count).toBe(result.countdown.length);
    expect(result.countdown).toHaveLength(4);
  });
});

describe('CountdownInput schema', () => {
  it('should validate valid input', () => {
    const result = CountdownInput.safeParse({ start: 5 });
    expect(result.success).toBe(true);
  });

  it('should reject zero', () => {
    const result = CountdownInput.safeParse({ start: 0 });
    expect(result.success).toBe(false);
  });

  it('should reject negative numbers', () => {
    const result = CountdownInput.safeParse({ start: -5 });
    expect(result.success).toBe(false);
  });

  it('should reject missing start', () => {
    const result = CountdownInput.safeParse({});
    expect(result.success).toBe(false);
  });

  it('should reject non-integer numbers', () => {
    const result = CountdownInput.safeParse({ start: 5.5 });
    expect(result.success).toBe(false);
  });
});
