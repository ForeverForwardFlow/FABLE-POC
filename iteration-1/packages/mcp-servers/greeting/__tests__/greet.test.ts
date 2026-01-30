import { describe, it, expect } from 'vitest';
import { greetTool, GreetInput } from '../src/tools/greet.js';

describe('greetTool', () => {
  it('should greet a person by name', async () => {
    const result = await greetTool({ name: 'Alice' });

    expect(result.greeting).toBe('Hello, Alice!');
    expect(result.name).toBe('Alice');
    expect(result.timestamp).toBeDefined();
  });

  it('should handle different names', async () => {
    const result = await greetTool({ name: 'Bob' });

    expect(result.greeting).toBe('Hello, Bob!');
    expect(result.name).toBe('Bob');
  });

  it('should include a timestamp', async () => {
    const result = await greetTool({ name: 'Charlie' });

    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

describe('GreetInput schema', () => {
  it('should validate valid input', () => {
    const result = GreetInput.safeParse({ name: 'test' });
    expect(result.success).toBe(true);
  });

  it('should reject empty name', () => {
    const result = GreetInput.safeParse({ name: '' });
    expect(result.success).toBe(false);
  });

  it('should reject missing name', () => {
    const result = GreetInput.safeParse({});
    expect(result.success).toBe(false);
  });
});
