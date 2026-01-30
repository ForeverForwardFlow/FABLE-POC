import { describe, it, expect } from 'vitest';
import { timestampTool, TimestampInput } from '../src/tools/timestamp.js';

describe('timestampTool', () => {
  it('should return current timestamp with ISO format', async () => {
    const result = await timestampTool({});

    expect(result.iso).toBeDefined();
    expect(result.iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('should return Unix epoch milliseconds', async () => {
    const result = await timestampTool({});

    expect(result.epoch).toBeDefined();
    expect(typeof result.epoch).toBe('number');
    expect(result.epoch).toBeGreaterThan(0);
  });

  it('should return consistent timestamp values', async () => {
    const before = Date.now();
    const result = await timestampTool({});
    const after = Date.now();

    expect(result.epoch).toBeGreaterThanOrEqual(before);
    expect(result.epoch).toBeLessThanOrEqual(after);
  });

  it('should have ISO and epoch representing the same time', async () => {
    const result = await timestampTool({});

    const isoTime = new Date(result.iso).getTime();
    expect(isoTime).toBe(result.epoch);
  });
});

describe('TimestampInput schema', () => {
  it('should validate empty object', () => {
    const result = TimestampInput.safeParse({});
    expect(result.success).toBe(true);
  });

  it('should allow empty input', () => {
    const result = TimestampInput.safeParse({});
    expect(result.success).toBe(true);
  });
});
