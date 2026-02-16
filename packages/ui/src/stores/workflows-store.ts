import { defineStore } from 'pinia';
import type { WorkflowDefinition } from '../types';

interface WorkflowsState {
  workflows: WorkflowDefinition[];
  loading: boolean;
  error: string | null;
  lastFetched: number | null;
}

const MCP_API_URL = import.meta.env.VITE_MCP_API_URL
  || 'https://25d5630rjb.execute-api.us-west-2.amazonaws.com';

export const useWorkflowsStore = defineStore('workflows', {
  state: (): WorkflowsState => ({
    workflows: [],
    loading: false,
    error: null,
    lastFetched: null,
  }),

  getters: {
    workflowCount: (state): number => state.workflows.length,
    activeWorkflows: (state): WorkflowDefinition[] =>
      state.workflows.filter(w => w.status === 'active'),
  },

  actions: {
    async fetchWorkflows(): Promise<void> {
      if (this.lastFetched && Date.now() - this.lastFetched < 30000) return;

      this.loading = true;
      this.error = null;

      try {
        const res = await fetch(`${MCP_API_URL}/workflows`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        this.workflows = (data.workflows || []) as WorkflowDefinition[];
        this.lastFetched = Date.now();
      } catch (err) {
        this.error = String(err);
        console.warn('[FABLE] Workflows fetch failed:', err);
      } finally {
        this.loading = false;
      }
    },

    async runWorkflow(workflowId: string, orgId: string): Promise<void> {
      const res = await fetch(`${MCP_API_URL}/workflows/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowId, orgId }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(errBody.error || `Run failed: HTTP ${res.status}`);
      }
    },

    async togglePause(workflowId: string, orgId: string, newStatus: 'active' | 'paused'): Promise<void> {
      const res = await fetch(`${MCP_API_URL}/workflows/pause`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowId, orgId, status: newStatus }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(errBody.error || `Status update failed: HTTP ${res.status}`);
      }

      // Update local state
      const wf = this.workflows.find(w => w.workflowId === workflowId);
      if (wf) wf.status = newStatus;
    },

    async deleteWorkflow(workflowId: string, orgId: string): Promise<void> {
      const res = await fetch(`${MCP_API_URL}/workflows/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowId, orgId }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(errBody.error || `Delete failed: HTTP ${res.status}`);
      }

      this.workflows = this.workflows.filter(w => w.workflowId !== workflowId);
    },

    invalidateCache(): void {
      this.lastFetched = null;
    },
  },
});
