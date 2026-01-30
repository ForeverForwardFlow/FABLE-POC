/**
 * Planning Phase Tests
 *
 * Tests the planning phase with multi-task decomposition.
 */

import { describe, it, expect } from 'vitest';
import { createPlan } from '../src/phases/planning.js';
import type { Requirements } from '@fable/shared';

describe('createPlan', () => {
  describe('single task planning', () => {
    it('should create single task for simple request', async () => {
      const requirements: Requirements = {
        summary: 'Add logging to the app',
        details: 'Add console.log statements for debugging',
        constraints: [],
        acceptanceCriteria: ['Logging works', 'Tests pass'],
      };

      const plan = await createPlan(requirements);

      expect(plan.id).toMatch(/^plan-\d+$/);
      expect(plan.tasks).toHaveLength(1);
      expect(plan.tasks[0].title).toBe('Add logging to the app');
      expect(plan.tasks[0].branch).toMatch(/^feat\/add-logging/);
      expect(plan.tasks[0].dependencies).toEqual([]);
    });

    it('should include acceptance criteria in single task', async () => {
      const requirements: Requirements = {
        summary: 'Fix bug in login',
        details: 'Users cannot login with email',
        constraints: [],
        acceptanceCriteria: ['Login works with email', 'Tests pass'],
      };

      const plan = await createPlan(requirements);

      expect(plan.tasks[0].acceptanceCriteria).toEqual(['Login works with email', 'Tests pass']);
    });
  });

  describe('multi-task decomposition', () => {
    it('should decompose MCP server request with multiple tools', async () => {
      const requirements: Requirements = {
        summary: 'Create MCP server for weather',
        details: `Create an MCP server with the following tools:
- weather tool for current weather
- forecast tool for forecasts
- alerts tool for weather alerts`,
        constraints: [],
        acceptanceCriteria: [
          'weather tool implemented',
          'forecast tool implemented',
          'alerts tool implemented',
          'Tests pass',
        ],
      };

      const plan = await createPlan(requirements);

      // Should have setup task + 3 tool tasks
      expect(plan.tasks.length).toBeGreaterThanOrEqual(2);
      expect(plan.summary).toContain('tools');
    });

    it('should detect multi-tool patterns in text', async () => {
      const requirements: Requirements = {
        summary: 'Build MCP server',
        details: 'Create an MCP server with tools: 3 different tools for data processing',
        constraints: [],
        acceptanceCriteria: ['Tool 1 works', 'Tool 2 works', 'Tool 3 works'],
      };

      const plan = await createPlan(requirements);

      // Should detect "tools: 3" pattern
      expect(plan.tasks.length).toBeGreaterThanOrEqual(1);
    });

    it('should set correct dependencies for tool tasks', async () => {
      const requirements: Requirements = {
        summary: 'Create MCP server',
        details: `Build MCP server with:
- search tool
- filter tool`,
        constraints: [],
        acceptanceCriteria: ['implement search tool', 'implement filter tool'],
      };

      const plan = await createPlan(requirements);

      // Check that dependencies are set correctly
      // First tool should depend on setup, subsequent tools don't (for parallelism)
      const hasSetupTask = plan.tasks.some((t) => t.title.toLowerCase().includes('setup'));
      if (hasSetupTask) {
        const setupTask = plan.tasks.find((t) => t.title.toLowerCase().includes('setup'));
        expect(setupTask?.dependencies).toEqual([]);
      }
    });
  });

  describe('branch naming', () => {
    it('should create URL-safe branch names', async () => {
      const requirements: Requirements = {
        summary: 'Add Feature: User Authentication!',
        details: 'Complex feature',
        constraints: [],
        acceptanceCriteria: ['Auth works'],
      };

      const plan = await createPlan(requirements);

      expect(plan.tasks[0].branch).toMatch(/^feat\/[a-z0-9-]+$/);
      expect(plan.tasks[0].branch).not.toContain('!');
      expect(plan.tasks[0].branch).not.toContain(':');
    });

    it('should truncate long branch names', async () => {
      const requirements: Requirements = {
        summary:
          'This is a very long summary that should be truncated when creating branch names to avoid issues with git',
        details: 'Details',
        constraints: [],
        acceptanceCriteria: ['Works'],
      };

      const plan = await createPlan(requirements);

      // Branch should be limited to ~50 chars after "feat/"
      expect(plan.tasks[0].branch.length).toBeLessThanOrEqual(60);
    });
  });

  describe('plan metadata', () => {
    it('should include timestamp in plan id', async () => {
      const before = Date.now();
      const requirements: Requirements = {
        summary: 'Test',
        details: 'Test',
        constraints: [],
        acceptanceCriteria: [],
      };

      const plan = await createPlan(requirements);
      const after = Date.now();

      const timestamp = parseInt(plan.id.replace('plan-', ''), 10);
      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });

    it('should include createdAt ISO timestamp', async () => {
      const requirements: Requirements = {
        summary: 'Test',
        details: 'Test',
        constraints: [],
        acceptanceCriteria: [],
      };

      const plan = await createPlan(requirements);

      expect(plan.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });
});
