import { describe, it, expect } from 'vitest';
import { echoTool, EchoInput } from '../src/tools/example.js';

describe('echoTool', () => {
  it('should echo back the message', async () => {
    const result = await echoTool({ message: 'hello', uppercase: false });

    expect(result.echo).toBe('hello');
    expect(result.length).toBe(5);
    expect(result.timestamp).toBeDefined();
  });

  it('should convert to uppercase when requested', async () => {
    const result = await echoTool({ message: 'hello', uppercase: true });

    expect(result.echo).toBe('HELLO');
  });

  it('should use default uppercase=false', async () => {
    const result = await echoTool({ message: 'Test' });

    expect(result.echo).toBe('Test');
  });
});

describe('EchoInput schema', () => {
  it('should validate valid input', () => {
    const result = EchoInput.safeParse({ message: 'test' });
    expect(result.success).toBe(true);
  });

  it('should reject empty message', () => {
    const result = EchoInput.safeParse({ message: '' });
    expect(result.success).toBe(false);
  });

  it('should reject missing message', () => {
    const result = EchoInput.safeParse({});
    expect(result.success).toBe(false);
  });

  it('should default uppercase to false', () => {
    const result = EchoInput.parse({ message: 'test' });
    expect(result.uppercase).toBe(false);
  });
});
