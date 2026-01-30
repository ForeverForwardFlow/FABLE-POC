/**
 * Integration Phase Tests
 *
 * Tests the integration phase that merges worker branches.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { integrateResults } from '../src/phases/integrate.js';
import type { WorkerResult, Plan } from '@fable/shared';

// Mock child_process and worktree utils
vi.mock('node:child_process', () => ({
  execSync: vi.fn((command: string) => {
    // Mock git commands
    if (command.includes('branch --show-current')) {
      return 'main\n';
    }
    if (command.includes('checkout')) {
      return '';
    }
    if (command.includes('rev-parse --verify')) {
      return 'abc123\n';
    }
    if (command.includes('merge-base')) {
      return 'def456\n';
    }
    if (command.includes('rev-parse feat/')) {
      return 'ghi789\n';
    }
    if (command.includes('merge')) {
      return '';
    }
    if (command.includes('npm run build')) {
      return '';
    }
    if (command.includes('npm run test')) {
      return '';
    }
    if (command.includes('branch -d')) {
      return '';
    }
    return '';
  }),
}));

vi.mock('../src/utils/worktree.js', () => ({
  cleanupWorktree: vi.fn().mockResolvedValue(undefined),
}));

describe('integrateResults', () => {
  const mockPlan: Plan = {
    id: 'plan-123',
    summary: 'Test plan',
    tasks: [
      {
        id: 'task-1',
        title: 'Task 1',
        description: 'First task',
        branch: 'feat/task-1',
        dependencies: [],
        acceptanceCriteria: ['Works'],
        interfaceContracts: {},
      },
      {
        id: 'task-2',
        title: 'Task 2',
        description: 'Second task',
        branch: 'feat/task-2',
        dependencies: ['task-1'],
        acceptanceCriteria: ['Works'],
        interfaceContracts: {},
      },
    ],
    createdAt: '2024-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('failure handling', () => {
    it('should return failed status when workers failed', async () => {
      const workerResults: WorkerResult[] = [
        { taskId: 'task-1', status: 'failed', error: 'Build failed' },
      ];

      const result = await integrateResults(workerResults, mockPlan);

      expect(result.status).toBe('failed');
      expect(result.message).toContain('worker(s) failed');
      expect(result.errors).toContain('Build failed');
    });

    it('should return incomplete status when workers incomplete', async () => {
      const workerResults: WorkerResult[] = [{ taskId: 'task-1', status: 'incomplete' }];

      const result = await integrateResults(workerResults, mockPlan);

      expect(result.status).toBe('incomplete');
      expect(result.message).toContain('did not complete');
    });

    it('should collect all error messages from failed workers', async () => {
      const workerResults: WorkerResult[] = [
        { taskId: 'task-1', status: 'failed', error: 'Error 1' },
        { taskId: 'task-2', status: 'failed', error: 'Error 2' },
      ];

      const result = await integrateResults(workerResults, mockPlan);

      expect(result.status).toBe('failed');
      expect(result.errors).toHaveLength(2);
      expect(result.errors).toContain('Error 1');
      expect(result.errors).toContain('Error 2');
    });
  });

  describe('successful integration', () => {
    it('should return success when all workers completed', async () => {
      const workerResults: WorkerResult[] = [
        { taskId: 'task-1', status: 'completed', branch: 'feat/task-1' },
        { taskId: 'task-2', status: 'completed', branch: 'feat/task-2' },
      ];

      const result = await integrateResults(workerResults, mockPlan);

      expect(result.status).toBe('success');
      expect(result.message).toContain('Successfully integrated');
    });

    it('should include worker results in output', async () => {
      const workerResults: WorkerResult[] = [
        { taskId: 'task-1', status: 'completed', branch: 'feat/task-1' },
      ];

      const result = await integrateResults(workerResults, {
        ...mockPlan,
        tasks: [mockPlan.tasks[0]],
      });

      expect(result.workerResults).toEqual(workerResults);
    });
  });

  describe('plan association', () => {
    it('should include plan in result', async () => {
      const singleTaskPlan = {
        ...mockPlan,
        tasks: [mockPlan.tasks[0]],
      };
      const workerResults: WorkerResult[] = [{ taskId: 'task-1', status: 'completed' }];

      const result = await integrateResults(workerResults, singleTaskPlan);

      expect(result.plan).toEqual(singleTaskPlan);
    });
  });
});
