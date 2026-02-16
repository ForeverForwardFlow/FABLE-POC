import { defineStore } from 'pinia';
import type { FableTool } from '../types';

interface ToolsState {
  tools: FableTool[];
  loading: boolean;
  error: string | null;
  lastFetched: number | null;
}

// MCP HTTP API endpoint (public /tools route)
const MCP_API_URL = import.meta.env.VITE_MCP_API_URL
  || 'https://25d5630rjb.execute-api.us-west-2.amazonaws.com';

export const useToolsStore = defineStore('tools', {
  state: (): ToolsState => ({
    tools: [],
    loading: false,
    error: null,
    lastFetched: null,
  }),

  getters: {
    getToolByName: (state) => {
      return (name: string) => state.tools.find(t => t.name === name);
    },
    toolCount: (state): number => state.tools.length,
  },

  actions: {
    async fetchTools(): Promise<void> {
      // Cache for 30 seconds
      if (this.lastFetched && Date.now() - this.lastFetched < 30000) return;

      this.loading = true;
      this.error = null;

      try {
        const res = await fetch(`${MCP_API_URL}/tools`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const toolsList = data.tools || [];

        // Deduplicate tools by name (keep first occurrence)
        const seen = new Set<string>();
        this.tools = toolsList
          .map((t: Record<string, unknown>) => ({
            name: t.name as string,
            description: t.description as string,
            inputSchema: (t.inputSchema || {}) as Record<string, unknown>,
            ...(t.uiDefinition && { uiDefinition: t.uiDefinition }),
          }))
          .filter((t: FableTool) => {
            if (seen.has(t.name)) return false;
            seen.add(t.name);
            return true;
          });

        this.lastFetched = Date.now();
      } catch (err) {
        this.error = String(err);
        console.warn('[FABLE] Tools fetch failed:', err);
      } finally {
        this.loading = false;
      }
    },

    invalidateCache(): void {
      this.lastFetched = null;
    },

    async deleteTool(name: string): Promise<void> {
      const res = await fetch(`${MCP_API_URL}/tools/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(errBody.error || `Delete failed: HTTP ${res.status}`);
      }

      // Remove from local state immediately
      this.tools = this.tools.filter(t => t.name !== name);
    },
  },
});
