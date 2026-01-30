import { describe, it, expect, vi, beforeEach } from 'vitest';
import { orchestrate } from '../src/index.js';

// Mock the phases for unit testing
vi.mock('../src/phases/requirements.js', () => ({
  gatherRequirements: vi.fn().mockResolvedValue({
    summary: 'test request',
    details: 'test details',
    constraints: [],
    acceptanceCriteria: ['test passes'],
  }),
}));

vi.mock('../src/phases/planning.js', () => ({
  createPlan: vi.fn().mockResolvedValue({
    id: 'plan-123',
    summary: 'test plan',
    tasks: [
      {
        id: 'task-1',
        title: 'test task',
        description: 'test description',
        branch: 'feat/test',
        dependencies: [],
        acceptanceCriteria: ['test passes'],
        interfaceContracts: {},
      },
    ],
    createdAt: '2024-01-01T00:00:00.000Z',
  }),
}));

vi.mock('../src/phases/dispatch.js', () => ({
  dispatchWorkers: vi.fn().mockResolvedValue([
    {
      taskId: 'task-1',
      status: 'completed',
      output: 'TASK_COMPLETE',
      branch: 'feat/test',
    },
  ]),
}));

vi.mock('../src/phases/integrate.js', () => ({
  integrateResults: vi.fn().mockResolvedValue({
    status: 'success',
    message: 'All tasks completed',
  }),
}));

describe('orchestrate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return dry_run result when dryRun is true', async () => {
    const result = await orchestrate('test request', { dryRun: true });

    expect(result.status).toBe('dry_run');
    expect(result.plan).toBeDefined();
    expect(result.plan?.tasks).toHaveLength(1);
  });

  it('should orchestrate full flow when dryRun is false', async () => {
    const result = await orchestrate('test request', { dryRun: false });

    expect(result.status).toBe('success');
    expect(result.message).toBe('All tasks completed');
  });

  it('should use default config when none provided', async () => {
    const result = await orchestrate('test request', { dryRun: true });

    expect(result.status).toBe('dry_run');
  });
});
