import { defineStore } from 'pinia';
import type { BuildRecord } from 'src/types';
import { fableWs } from 'src/boot/websocket';

interface BuildsState {
  builds: BuildRecord[];
  loading: boolean;
  error: string | null;
}

export const useBuildsStore = defineStore('builds', {
  state: (): BuildsState => ({
    builds: [],
    loading: false,
    error: null,
  }),

  getters: {
    completedCount: (state) => state.builds.filter(b => b.status === 'completed').length,
    failedCount: (state) => state.builds.filter(b => b.status === 'failed' || b.status === 'needs_help').length,
    activeCount: (state) => state.builds.filter(b => b.status === 'pending' || b.status === 'retrying').length,
  },

  actions: {
    fetchBuilds() {
      this.loading = true;
      this.error = null;
      fableWs.send({ type: 'list_builds' });
    },

    handleBuildsList(builds: BuildRecord[]) {
      this.builds = builds;
      this.loading = false;
      this.error = null;
    },

    handleError(message: string) {
      this.loading = false;
      this.error = message;
    },
  },
});
