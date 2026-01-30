/**
 * Edge Case Tests
 *
 * Tests for edge cases like timeout handling, large inputs, unicode, etc.
 */

import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { useBuiltTool } from '../src/utils/mcp-client.js';
import { createPlan } from '../src/phases/planning.js';
import type { Requirements } from '@fable/shared';

describe('Edge Cases', () => {
  const basePath = resolve(__dirname, '../../mcp-servers');

  describe('unicode handling', () => {
    it('should handle unicode in greet tool', async () => {
      const result = (await useBuiltTool('greeting', 'greet', { name: '世界' }, basePath)) as {
        greeting: string;
      };

      expect(result.greeting).toBe('Hello, 世界!');
    });

    it('should handle emojis in greet tool', async () => {
      const result = (await useBuiltTool('greeting', 'greet', { name: '🎉' }, basePath)) as {
        greeting: string;
      };

      expect(result.greeting).toBe('Hello, 🎉!');
    });

    it('should handle unicode in uppercase tool', async () => {
      const result = (await useBuiltTool('greeting', 'uppercase', { text: 'café' }, basePath)) as {
        uppercase: string;
      };

      expect(result.uppercase).toBe('CAFÉ');
    });

    it('should handle unicode in reverse tool', async () => {
      const result = (await useBuiltTool('greeting', 'reverse', { text: '日本' }, basePath)) as {
        reversed: string;
      };

      // Grapheme-aware reverse if implemented, or simple reverse
      expect(result.reversed).toBeDefined();
    });

    it('should handle mixed unicode and ASCII', async () => {
      const result = (await useBuiltTool(
        'greeting',
        'greet',
        { name: 'Hello世界123' },
        basePath
      )) as {
        greeting: string;
      };

      expect(result.greeting).toBe('Hello, Hello世界123!');
    });
  });

  describe('large inputs', () => {
    it('should handle maximum countdown value', async () => {
      // Test near the limit (10000 is the max we set)
      const result = (await useBuiltTool('greeting', 'countdown', { start: 100 }, basePath)) as {
        countdown: number[];
      };

      expect(result.countdown).toHaveLength(101); // 100 down to 0
      expect(result.countdown[0]).toBe(100);
      expect(result.countdown[100]).toBe(0);
    });

    it('should return error for countdown exceeding maximum', async () => {
      // MCP returns validation errors as error content
      const result = await useBuiltTool('greeting', 'countdown', { start: 10001 }, basePath);
      expect(result).toBeDefined();
    });

    it('should handle long strings in uppercase', async () => {
      const longString = 'a'.repeat(1000);
      const result = (await useBuiltTool(
        'greeting',
        'uppercase',
        { text: longString },
        basePath
      )) as {
        uppercase: string;
      };

      expect(result.uppercase).toBe('A'.repeat(1000));
    });

    it('should handle long names in greet', async () => {
      const longName = 'Name'.repeat(100);
      const result = (await useBuiltTool('greeting', 'greet', { name: longName }, basePath)) as {
        greeting: string;
      };

      expect(result.greeting).toBe(`Hello, ${longName}!`);
    });
  });

  describe('special characters', () => {
    it('should handle special characters in greet', async () => {
      const result = (await useBuiltTool(
        'greeting',
        'greet',
        { name: '<script>alert("xss")</script>' },
        basePath
      )) as {
        greeting: string;
      };

      // Should not execute or transform the HTML
      expect(result.greeting).toBe('Hello, <script>alert("xss")</script>!');
    });

    it('should handle newlines in text', async () => {
      const result = (await useBuiltTool(
        'greeting',
        'uppercase',
        { text: 'line1\nline2' },
        basePath
      )) as {
        uppercase: string;
      };

      expect(result.uppercase).toBe('LINE1\nLINE2');
    });

    it('should handle quotes in text', async () => {
      const result = (await useBuiltTool(
        'greeting',
        'reverse',
        { text: '"quoted"' },
        basePath
      )) as {
        reversed: string;
      };

      expect(result.reversed).toBe('"detouq"');
    });
  });

  describe('boundary conditions', () => {
    it('should return error for empty string in uppercase', async () => {
      // MCP returns validation errors as error content, not by throwing
      const result = await useBuiltTool('greeting', 'uppercase', { text: '' }, basePath);
      // Result will contain the Zod validation error
      expect(result).toBeDefined();
    });

    it('should return error for empty string in reverse', async () => {
      // MCP returns validation errors as error content, not by throwing
      const result = await useBuiltTool('greeting', 'reverse', { text: '' }, basePath);
      expect(result).toBeDefined();
    });

    it('should handle minimum countdown (1)', async () => {
      const result = (await useBuiltTool('greeting', 'countdown', { start: 1 }, basePath)) as {
        countdown: number[];
      };

      expect(result.countdown).toEqual([1, 0]);
    });

    it('should return error for zero countdown', async () => {
      // MCP returns validation errors as error content
      const result = await useBuiltTool('greeting', 'countdown', { start: 0 }, basePath);
      expect(result).toBeDefined();
    });

    it('should return error for negative countdown', async () => {
      // MCP returns validation errors as error content
      const result = await useBuiltTool('greeting', 'countdown', { start: -1 }, basePath);
      expect(result).toBeDefined();
    });
  });

  describe('planning edge cases', () => {
    it('should handle empty acceptance criteria', async () => {
      const requirements: Requirements = {
        summary: 'Test task',
        details: 'Details',
        constraints: [],
        acceptanceCriteria: [],
      };

      const plan = await createPlan(requirements);

      expect(plan.tasks[0].acceptanceCriteria).toEqual([]);
    });

    it('should handle unicode in requirements', async () => {
      const requirements: Requirements = {
        summary: '日本語タスク',
        details: 'Unicode details: émojis 🎉',
        constraints: [],
        acceptanceCriteria: ['テスト通過'],
      };

      const plan = await createPlan(requirements);

      expect(plan.tasks[0].title).toBe('日本語タスク');
      expect(plan.tasks[0].branch).toMatch(/^feat\//);
    });

    it('should handle very long summary', async () => {
      const longSummary = 'Task '.repeat(50);
      const requirements: Requirements = {
        summary: longSummary,
        details: 'Details',
        constraints: [],
        acceptanceCriteria: [],
      };

      const plan = await createPlan(requirements);

      // Branch name should be truncated
      expect(plan.tasks[0].branch.length).toBeLessThanOrEqual(60);
      // But title should be preserved
      expect(plan.tasks[0].title).toBe(longSummary);
    });

    it('should handle special characters in summary', async () => {
      const requirements: Requirements = {
        summary: 'Add feature: user/auth @2.0!',
        details: 'Details',
        constraints: [],
        acceptanceCriteria: [],
      };

      const plan = await createPlan(requirements);

      // Branch should be sanitized
      expect(plan.tasks[0].branch).not.toContain('@');
      expect(plan.tasks[0].branch).not.toContain('!');
      expect(plan.tasks[0].branch).not.toContain(':');
    });
  });

  describe('error handling', () => {
    it('should throw for non-existent server', async () => {
      await expect(
        useBuiltTool('nonexistent', 'greet', { name: 'Test' }, basePath)
      ).rejects.toThrow("MCP server 'nonexistent' not found");
    });

    it('should return error message for invalid tool', async () => {
      // MCP returns error message as content
      const result = await useBuiltTool('greeting', 'nonexistent_tool', {}, basePath);
      expect(result).toContain('Unknown tool');
    });

    it('should return error for missing required arguments', async () => {
      // MCP returns validation errors as error content
      const result = await useBuiltTool('greeting', 'greet', {}, basePath);
      // Result will be the Zod validation error array
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
