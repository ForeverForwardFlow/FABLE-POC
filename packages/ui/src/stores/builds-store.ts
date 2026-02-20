import { defineStore } from 'pinia';
import type { BuildRecord, BuildDetailRecord, BuildProgressPayload } from 'src/types';
import { fableWs } from 'src/boot/websocket';

export interface BuildProgressEntry {
  phase: string;
  message: string;
  progress?: number;
  iteration?: number;
  maxIterations?: number;
  timestamp: string;
}

interface BuildsState {
  builds: BuildRecord[];
  currentBuild: BuildDetailRecord | null;
  loading: boolean;
  detailLoading: boolean;
  error: string | null;
  statusFilter: string | null;
  searchQuery: string;
  buildProgress: Record<string, BuildProgressEntry[]>;
}

export const useBuildsStore = defineStore('builds', {
  state: (): BuildsState => ({
    builds: [],
    currentBuild: null,
    loading: false,
    detailLoading: false,
    error: null,
    statusFilter: null,
    searchQuery: '',
    buildProgress: {},
  }),

  getters: {
    completedCount: (state) => state.builds.filter(b => b.status === 'completed').length,
    failedCount: (state) => state.builds.filter(b => b.status === 'failed' || b.status === 'needs_help').length,
    activeCount: (state) => state.builds.filter(b => b.status === 'pending' || b.status === 'retrying').length,

    filteredBuilds: (state) => {
      let result = state.builds;
      if (state.statusFilter) {
        if (state.statusFilter === 'failed') {
          result = result.filter(b => b.status === 'failed' || b.status === 'needs_help');
        } else if (state.statusFilter === 'active') {
          result = result.filter(b => b.status === 'pending' || b.status === 'retrying');
        } else {
          result = result.filter(b => b.status === state.statusFilter);
        }
      }
      if (state.searchQuery.trim()) {
        const q = state.searchQuery.toLowerCase();
        result = result.filter(b =>
          (b.request || '').toLowerCase().includes(q) ||
          b.buildId.toLowerCase().includes(q)
        );
      }
      return result;
    },

    // Build health metrics
    successRate: (state) => {
      const terminal = state.builds.filter(b => b.status === 'completed' || b.status === 'failed' || b.status === 'needs_help');
      if (terminal.length === 0) return 0;
      return Math.round((terminal.filter(b => b.status === 'completed').length / terminal.length) * 100);
    },
  },

  actions: {
    fetchBuilds() {
      this.loading = true;
      this.error = null;
      fableWs.send({ type: 'list_builds' });
    },

    fetchBuildDetail(buildId: string) {
      this.detailLoading = true;
      this.currentBuild = null;
      fableWs.send({ type: 'get_build', payload: { buildId } });
    },

    handleBuildsList(builds: BuildRecord[]) {
      this.builds = builds;
      this.loading = false;
      this.error = null;
    },

    handleBuildDetail(build: BuildDetailRecord) {
      this.currentBuild = build;
      this.detailLoading = false;
    },

    handleError(message: string) {
      this.loading = false;
      this.detailLoading = false;
      this.error = message;
    },

    setStatusFilter(filter: string | null) {
      this.statusFilter = filter;
    },

    setSearchQuery(query: string) {
      this.searchQuery = query;
    },

    handleBuildProgress(payload: BuildProgressPayload) {
      const entry: BuildProgressEntry = {
        phase: payload.phase,
        message: payload.message,
        progress: payload.progress,
        iteration: payload.iteration,
        maxIterations: payload.maxIterations,
        timestamp: payload.timestamp,
      };
      if (!this.buildProgress[payload.buildId]) {
        this.buildProgress[payload.buildId] = [];
      }
      this.buildProgress[payload.buildId].push(entry);
    },

    getLatestProgress(buildId: string): BuildProgressEntry | null {
      const log = this.buildProgress[buildId];
      return log?.length ? log[log.length - 1] : null;
    },

    clearBuildProgress(buildId: string) {
      delete this.buildProgress[buildId];
    },
  },
});
