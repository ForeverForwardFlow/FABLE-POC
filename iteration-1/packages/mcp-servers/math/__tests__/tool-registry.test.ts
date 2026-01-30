/**
 * Tool Registry Tests
 *
 * Tests for the auto-registration pattern infrastructure.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { registerTool, getRegisteredTools, getTool, clearRegistry } from '../src/tool-registry.js';
import { z } from 'zod';

describe('Tool Registry', () => {
  beforeEach(() => {
    clearRegistry();
  });

  describe('registerTool', () => {
    it('should register a tool successfully', () => {
      const testTool = {
        name: 'test-tool',
        description: 'A test tool',
        inputSchema: { type: 'object' },
        zodSchema: z.object({ value: z.number() }),
        handler: async (input: unknown) => input,
      };

      registerTool(testTool);

      const tools = getRegisteredTools();
      expect(tools).toHaveLength(1);
      expect(tools[0]).toEqual(testTool);
    });

    it('should throw error when registering duplicate tool name', () => {
      const testTool = {
        name: 'duplicate',
        description: 'First tool',
        inputSchema: { type: 'object' },
        zodSchema: z.object({}),
        handler: async (input: unknown) => input,
      };

      registerTool(testTool);

      expect(() => registerTool(testTool)).toThrow('Tool "duplicate" is already registered');
    });
  });

  describe('getRegisteredTools', () => {
    it('should return empty array when no tools registered', () => {
      const tools = getRegisteredTools();
      expect(tools).toEqual([]);
    });

    it('should return all registered tools', () => {
      const tool1 = {
        name: 'tool1',
        description: 'Tool 1',
        inputSchema: { type: 'object' },
        zodSchema: z.object({}),
        handler: async (input: unknown) => input,
      };

      const tool2 = {
        name: 'tool2',
        description: 'Tool 2',
        inputSchema: { type: 'object' },
        zodSchema: z.object({}),
        handler: async (input: unknown) => input,
      };

      registerTool(tool1);
      registerTool(tool2);

      const tools = getRegisteredTools();
      expect(tools).toHaveLength(2);
      expect(tools).toContainEqual(tool1);
      expect(tools).toContainEqual(tool2);
    });
  });

  describe('getTool', () => {
    it('should return undefined for non-existent tool', () => {
      const tool = getTool('non-existent');
      expect(tool).toBeUndefined();
    });

    it('should return registered tool by name', () => {
      const testTool = {
        name: 'get-test',
        description: 'Get test tool',
        inputSchema: { type: 'object' },
        zodSchema: z.object({}),
        handler: async (input: unknown) => input,
      };

      registerTool(testTool);

      const tool = getTool('get-test');
      expect(tool).toEqual(testTool);
    });
  });

  describe('clearRegistry', () => {
    it('should clear all registered tools', () => {
      const testTool = {
        name: 'clear-test',
        description: 'Clear test tool',
        inputSchema: { type: 'object' },
        zodSchema: z.object({}),
        handler: async (input: unknown) => input,
      };

      registerTool(testTool);
      expect(getRegisteredTools()).toHaveLength(1);

      clearRegistry();
      expect(getRegisteredTools()).toHaveLength(0);
    });
  });
});
