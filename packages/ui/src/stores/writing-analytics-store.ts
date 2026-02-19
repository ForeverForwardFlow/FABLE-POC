import { defineStore } from 'pinia';

export interface WritingAnalysis {
  id: string;
  timestamp: string;
  readabilityScore: number;
  readabilityLevel: 'easy' | 'moderate' | 'hard' | 'expert';
  wordCount: number;
  sentenceCount: number;
  avgSentenceLength: number;
  complexityRating: number;
  issues: Array<{ type: string; count: number }>;
  text: string;
}

interface WritingAnalyticsState {
  analyses: WritingAnalysis[];
  loading: boolean;
  error: string | null;
}

export const useWritingAnalyticsStore = defineStore('writing-analytics', {
  state: (): WritingAnalyticsState => ({
    analyses: [],
    loading: false,
    error: null,
  }),

  getters: {
    sortedAnalyses: (state) => {
      return [...state.analyses].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
    },

    // Get analyses within a date range
    getAnalysesByDateRange: (state) => {
      return (startDate: Date, endDate: Date) => {
        return state.analyses.filter((analysis) => {
          const timestamp = new Date(analysis.timestamp);
          return timestamp >= startDate && timestamp <= endDate;
        });
      };
    },

    // Average readability score
    averageReadabilityScore: (state) => {
      if (state.analyses.length === 0) return 0;
      const sum = state.analyses.reduce((acc, a) => acc + a.readabilityScore, 0);
      return Math.round((sum / state.analyses.length) * 10) / 10;
    },

    // Average word count
    averageWordCount: (state) => {
      if (state.analyses.length === 0) return 0;
      const sum = state.analyses.reduce((acc, a) => acc + a.wordCount, 0);
      return Math.round(sum / state.analyses.length);
    },

    // Readability level distribution
    readabilityDistribution: (state) => {
      const distribution = { easy: 0, moderate: 0, hard: 0, expert: 0 };
      state.analyses.forEach((a) => {
        distribution[a.readabilityLevel]++;
      });
      return distribution;
    },

    // Most common issues
    topIssues: (state) => {
      const issueMap = new Map<string, number>();
      state.analyses.forEach((analysis) => {
        analysis.issues.forEach((issue) => {
          const current = issueMap.get(issue.type) || 0;
          issueMap.set(issue.type, current + issue.count);
        });
      });

      return Array.from(issueMap.entries())
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
    },
  },

  actions: {
    // Load analyses from localStorage
    loadAnalyses() {
      this.loading = true;
      try {
        const stored = localStorage.getItem('fable-writing-analyses');
        if (stored) {
          this.analyses = JSON.parse(stored);
        }
      } catch (err) {
        this.error = 'Failed to load analyses';
        console.error('[WritingAnalytics] Load failed:', err);
      } finally {
        this.loading = false;
      }
    },

    // Save analyses to localStorage
    saveAnalyses() {
      try {
        localStorage.setItem('fable-writing-analyses', JSON.stringify(this.analyses));
      } catch (err) {
        console.error('[WritingAnalytics] Save failed:', err);
      }
    },

    // Add a new analysis (called when writing-quality-analyzer tool is used)
    addAnalysis(analysis: Omit<WritingAnalysis, 'id'>) {
      const newAnalysis: WritingAnalysis = {
        ...analysis,
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      };
      this.analyses.push(newAnalysis);
      this.saveAnalyses();
    },

    // Clear all analyses
    clearAnalyses() {
      this.analyses = [];
      this.saveAnalyses();
    },

    // Delete a specific analysis
    deleteAnalysis(id: string) {
      this.analyses = this.analyses.filter((a) => a.id !== id);
      this.saveAnalyses();
    },

    // Export data as JSON
    exportData(): string {
      return JSON.stringify(this.analyses, null, 2);
    },

    // Import data from JSON
    importData(jsonString: string) {
      try {
        const data = JSON.parse(jsonString);
        if (Array.isArray(data)) {
          this.analyses = data;
          this.saveAnalyses();
        } else {
          throw new Error('Invalid data format');
        }
      } catch (err) {
        this.error = 'Failed to import data';
        throw err;
      }
    },
  },
});
