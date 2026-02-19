<template>
  <q-page class="writing-analytics-page">
    <div class="writing-analytics-page__header">
      <div>
        <h1 class="writing-analytics-page__title">Writing Analytics</h1>
        <p class="writing-analytics-page__subtitle">
          Track writing quality trends and insights over time
        </p>
      </div>
      <div class="writing-analytics-page__actions">
        <q-btn
          flat
          icon="file_download"
          label="Export"
          color="purple"
          no-caps
          @click="exportData"
        />
        <q-btn
          flat
          icon="delete_outline"
          label="Clear All"
          color="grey"
          no-caps
          @click="confirmClearAll"
        />
      </div>
    </div>

    <!-- Empty State -->
    <div v-if="!loading && analyses.length === 0" class="writing-analytics-page__empty">
      <q-icon name="analytics" size="64px" color="grey-7" />
      <h3>No analytics data yet</h3>
      <p>Start analyzing text with the <strong>writing-quality-analyzer</strong> tool to see trends here.</p>
      <q-btn
        outline
        color="purple"
        label="Go to Tools"
        icon="build"
        no-caps
        :to="{ name: 'tools' }"
      />
    </div>

    <!-- Loading State -->
    <div v-else-if="loading" class="writing-analytics-page__loading">
      <q-spinner-dots color="purple" size="40px" />
    </div>

    <!-- Analytics Dashboard -->
    <template v-else>
      <!-- Date Range Selector -->
      <div class="writing-analytics-page__filters">
        <q-btn-toggle
          v-model="dateRange"
          toggle-color="purple"
          :options="[
            { label: 'Last 7 Days', value: '7d' },
            { label: 'Last 30 Days', value: '30d' },
            { label: 'Last 90 Days', value: '90d' },
            { label: 'All Time', value: 'all' },
          ]"
          no-caps
          unelevated
        />
      </div>

      <!-- Summary Cards -->
      <div class="writing-analytics-page__summary">
        <div class="summary-card">
          <q-icon name="speed" size="32px" color="purple" />
          <div class="summary-card__content">
            <div class="summary-card__value">{{ avgReadability }}</div>
            <div class="summary-card__label">Avg Readability</div>
          </div>
        </div>

        <div class="summary-card">
          <q-icon name="description" size="32px" color="teal" />
          <div class="summary-card__content">
            <div class="summary-card__value">{{ filteredAnalyses.length }}</div>
            <div class="summary-card__label">Analyses</div>
          </div>
        </div>

        <div class="summary-card">
          <q-icon name="text_fields" size="32px" color="amber" />
          <div class="summary-card__content">
            <div class="summary-card__value">{{ avgWordCount }}</div>
            <div class="summary-card__label">Avg Word Count</div>
          </div>
        </div>

        <div class="summary-card">
          <q-icon name="trending_up" size="32px" color="green" />
          <div class="summary-card__content">
            <div class="summary-card__value">{{ mostCommonLevel }}</div>
            <div class="summary-card__label">Most Common Level</div>
          </div>
        </div>
      </div>

      <!-- Charts Grid -->
      <div class="writing-analytics-page__charts">
        <!-- Readability Score Over Time -->
        <div class="chart-card">
          <div class="chart-card__header">
            <h3 class="chart-card__title">Readability Score Over Time</h3>
            <q-icon name="show_chart" size="20px" color="grey-6" />
          </div>
          <div class="chart-card__body">
            <Line :data="readabilityChartData" :options="lineChartOptions" />
          </div>
        </div>

        <!-- Readability Level Distribution -->
        <div class="chart-card">
          <div class="chart-card__header">
            <h3 class="chart-card__title">Readability Level Distribution</h3>
            <q-icon name="donut_large" size="20px" color="grey-6" />
          </div>
          <div class="chart-card__body">
            <Doughnut :data="distributionChartData" :options="doughnutChartOptions" />
          </div>
        </div>

        <!-- Word Count and Sentence Length Trends -->
        <div class="chart-card">
          <div class="chart-card__header">
            <h3 class="chart-card__title">Word Count & Sentence Length Trends</h3>
            <q-icon name="timeline" size="20px" color="grey-6" />
          </div>
          <div class="chart-card__body">
            <Line :data="wordCountChartData" :options="lineChartOptions" />
          </div>
        </div>

        <!-- Common Writing Issues -->
        <div class="chart-card">
          <div class="chart-card__header">
            <h3 class="chart-card__title">Most Common Writing Issues</h3>
            <q-icon name="bar_chart" size="20px" color="grey-6" />
          </div>
          <div class="chart-card__body">
            <Bar :data="issuesChartData" :options="barChartOptions" />
          </div>
        </div>
      </div>
    </template>

    <!-- Clear All Dialog -->
    <q-dialog v-model="clearDialog">
      <q-card class="confirm-dialog">
        <q-card-section>
          <div class="text-h6">Clear All Analytics Data</div>
        </q-card-section>
        <q-card-section>
          This will permanently delete all writing analytics data. This action cannot be undone.
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn
            flat
            label="Clear All"
            color="negative"
            @click="handleClearAll"
            v-close-popup
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useQuasar } from 'quasar';
import { useWritingAnalyticsStore } from 'src/stores/writing-analytics-store';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line, Bar, Doughnut } from 'vue-chartjs';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

const $q = useQuasar();
const analyticsStore = useWritingAnalyticsStore();
const dateRange = ref<'7d' | '30d' | '90d' | 'all'>('30d');
const clearDialog = ref(false);
const loading = ref(false);

const analyses = computed(() => analyticsStore.sortedAnalyses);

const filteredAnalyses = computed(() => {
  if (dateRange.value === 'all') return analyses.value;

  const now = new Date();
  const days = dateRange.value === '7d' ? 7 : dateRange.value === '30d' ? 30 : 90;
  const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  return analyses.value.filter((a) => new Date(a.timestamp) >= startDate);
});

const avgReadability = computed(() => {
  if (filteredAnalyses.value.length === 0) return '0';
  const sum = filteredAnalyses.value.reduce((acc, a) => acc + a.readabilityScore, 0);
  return (sum / filteredAnalyses.value.length).toFixed(1);
});

const avgWordCount = computed(() => {
  if (filteredAnalyses.value.length === 0) return '0';
  const sum = filteredAnalyses.value.reduce((acc, a) => acc + a.wordCount, 0);
  return Math.round(sum / filteredAnalyses.value.length).toString();
});

const mostCommonLevel = computed(() => {
  const distribution = { easy: 0, moderate: 0, hard: 0, expert: 0 };
  filteredAnalyses.value.forEach((a) => {
    distribution[a.readabilityLevel]++;
  });
  const sorted = Object.entries(distribution).sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0] || 'N/A';
});

// Chart data
const readabilityChartData = computed(() => {
  const sorted = [...filteredAnalyses.value].reverse();
  return {
    labels: sorted.map((a) => new Date(a.timestamp).toLocaleDateString()),
    datasets: [
      {
        label: 'Readability Score',
        data: sorted.map((a) => a.readabilityScore),
        borderColor: '#a855f7',
        backgroundColor: 'rgba(168, 85, 247, 0.1)',
        fill: true,
        tension: 0.4,
      },
    ],
  };
});

const distributionChartData = computed(() => {
  const distribution = { easy: 0, moderate: 0, hard: 0, expert: 0 };
  filteredAnalyses.value.forEach((a) => {
    distribution[a.readabilityLevel]++;
  });

  return {
    labels: ['Easy', 'Moderate', 'Hard', 'Expert'],
    datasets: [
      {
        data: [distribution.easy, distribution.moderate, distribution.hard, distribution.expert],
        backgroundColor: ['#4ade80', '#fbbf24', '#fb923c', '#ef4444'],
        borderWidth: 0,
      },
    ],
  };
});

const wordCountChartData = computed(() => {
  const sorted = [...filteredAnalyses.value].reverse();
  return {
    labels: sorted.map((a) => new Date(a.timestamp).toLocaleDateString()),
    datasets: [
      {
        label: 'Word Count',
        data: sorted.map((a) => a.wordCount),
        borderColor: '#14b8a6',
        backgroundColor: 'rgba(20, 184, 166, 0.1)',
        fill: true,
        tension: 0.4,
        yAxisID: 'y',
      },
      {
        label: 'Avg Sentence Length',
        data: sorted.map((a) => a.avgSentenceLength),
        borderColor: '#f59e0b',
        backgroundColor: 'rgba(245, 158, 11, 0.1)',
        fill: true,
        tension: 0.4,
        yAxisID: 'y1',
      },
    ],
  };
});

const issuesChartData = computed(() => {
  const issueMap = new Map<string, number>();
  filteredAnalyses.value.forEach((analysis) => {
    analysis.issues.forEach((issue) => {
      const current = issueMap.get(issue.type) || 0;
      issueMap.set(issue.type, current + issue.count);
    });
  });

  const topIssues = Array.from(issueMap.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return {
    labels: topIssues.map((i) => i.type),
    datasets: [
      {
        label: 'Frequency',
        data: topIssues.map((i) => i.count),
        backgroundColor: '#a855f7',
      },
    ],
  };
});

// Chart options
const lineChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      display: true,
      labels: { color: '#9ca3af' },
    },
    tooltip: {
      mode: 'index' as const,
      intersect: false,
    },
  },
  scales: {
    x: {
      ticks: { color: '#9ca3af' },
      grid: { color: 'rgba(255, 255, 255, 0.05)' },
    },
    y: {
      ticks: { color: '#9ca3af' },
      grid: { color: 'rgba(255, 255, 255, 0.05)' },
    },
    y1: {
      position: 'right' as const,
      ticks: { color: '#9ca3af' },
      grid: { display: false },
    },
  },
};

const doughnutChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'right' as const,
      labels: { color: '#9ca3af' },
    },
  },
};

const barChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
  },
  scales: {
    x: {
      ticks: { color: '#9ca3af' },
      grid: { color: 'rgba(255, 255, 255, 0.05)' },
    },
    y: {
      ticks: { color: '#9ca3af' },
      grid: { color: 'rgba(255, 255, 255, 0.05)' },
    },
  },
};

function exportData() {
  const dataStr = analyticsStore.exportData();
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `writing-analytics-${new Date().toISOString().split('T')[0]}.json`;
  link.click();
  URL.revokeObjectURL(url);
  $q.notify({ type: 'positive', message: 'Data exported successfully' });
}

function confirmClearAll() {
  clearDialog.value = true;
}

function handleClearAll() {
  analyticsStore.clearAnalyses();
  $q.notify({ type: 'positive', message: 'All analytics data cleared' });
}

onMounted(() => {
  loading.value = true;
  analyticsStore.loadAnalyses();
  loading.value = false;
});
</script>

<style lang="scss" scoped>
.writing-analytics-page {
  padding: 24px;
  max-width: 1400px;
  margin: 0 auto;

  &__header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 32px;
    gap: 16px;
  }

  &__title {
    font-size: 32px;
    font-weight: 700;
    color: var(--ff-text-primary);
    margin: 0 0 8px;
  }

  &__subtitle {
    font-size: 14px;
    color: var(--ff-text-muted);
    margin: 0;
  }

  &__actions {
    display: flex;
    gap: 8px;
  }

  &__empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    padding: 80px 0;
    text-align: center;

    h3 {
      font-size: 20px;
      font-weight: 600;
      color: var(--ff-text-primary);
      margin: 0;
    }

    p {
      font-size: 14px;
      color: var(--ff-text-muted);
      margin: 0;
      max-width: 400px;
    }
  }

  &__loading {
    display: flex;
    justify-content: center;
    padding: 80px 0;
  }

  &__filters {
    margin-bottom: 24px;
  }

  &__summary {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 16px;
    margin-bottom: 32px;
  }

  &__charts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(500px, 1fr));
    gap: 24px;
  }
}

.summary-card {
  background: var(--ff-bg-card);
  border: 1px solid var(--ff-border);
  border-radius: var(--ff-radius-lg);
  padding: 24px;
  display: flex;
  align-items: center;
  gap: 16px;

  &__content {
    flex: 1;
  }

  &__value {
    font-size: 28px;
    font-weight: 700;
    color: var(--ff-text-primary);
    margin-bottom: 4px;
  }

  &__label {
    font-size: 13px;
    color: var(--ff-text-muted);
  }
}

.chart-card {
  background: var(--ff-bg-card);
  border: 1px solid var(--ff-border);
  border-radius: var(--ff-radius-lg);
  padding: 24px;

  &__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
  }

  &__title {
    font-size: 16px;
    font-weight: 600;
    color: var(--ff-text-primary);
    margin: 0;
  }

  &__body {
    height: 300px;
  }
}

.confirm-dialog {
  background: var(--ff-bg-card);
  min-width: 400px;
}

@media (max-width: 768px) {
  .writing-analytics-page {
    padding: 16px;

    &__header {
      flex-direction: column;
      align-items: flex-start;
    }

    &__summary {
      grid-template-columns: 1fr;
    }

    &__charts {
      grid-template-columns: 1fr;
    }
  }
}
</style>
