import { defineStore } from 'pinia';
import type { UIState } from '../types';

export const useUIStore = defineStore('ui', {
  state: (): UIState => ({
    sidebarOpen: typeof window !== 'undefined' ? window.innerWidth >= 768 : true,
    detailsExpanded: false
  }),

  getters: {
    isMobile: (): boolean => {
      return window.innerWidth < 768;
    }
  },

  actions: {
    toggleSidebar(): void {
      this.sidebarOpen = !this.sidebarOpen;
    },

    toggleDetails(): void {
      this.detailsExpanded = !this.detailsExpanded;
    },

    setSidebarOpen(open: boolean): void {
      this.sidebarOpen = open;
    },

    setDetailsExpanded(expanded: boolean): void {
      this.detailsExpanded = expanded;
    },

    closeSidebarOnMobile(): void {
      if (window.innerWidth < 768) {
        this.sidebarOpen = false;
      }
    }
  }
});
