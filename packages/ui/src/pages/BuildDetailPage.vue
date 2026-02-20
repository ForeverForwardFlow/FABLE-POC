<template>
  <q-page class="build-detail">
    <div class="build-detail__header">
      <q-btn flat dense icon="arrow_back" color="positive" @click="$router.push({ name: 'builds' })" />
      <h1 class="build-detail__title">Build Detail</h1>
    </div>

    <!-- Loading -->
    <div v-if="buildsStore.detailLoading" class="build-detail__loading">
      <q-spinner-dots size="40px" color="positive" />
    </div>

    <!-- Error -->
    <div v-else-if="buildsStore.error" class="build-detail__empty">
      <q-icon name="error_outline" size="48px" color="negative" />
      <p>{{ buildsStore.error }}</p>
      <q-btn flat no-caps color="positive" label="Back to Builds" @click="$router.push({ name: 'builds' })" />
    </div>

    <!-- Build Content -->
    <template v-else-if="build">
      <!-- Status + Meta -->
      <div class="build-detail__meta">
        <div class="build-detail__meta-row">
          <span class="build-detail__status" :class="'build-detail__status--' + build.status">
            {{ build.status }}
          </span>
          <span v-if="build.buildCycle > 1" class="build-detail__cycle">
            <q-icon name="replay" size="14px" /> Cycle {{ build.buildCycle }}
          </span>
        </div>
        <p class="build-detail__request">{{ build.request }}</p>
        <div class="build-detail__timestamps">
          <span><strong>Started:</strong> {{ formatDate(build.createdAt) }}</span>
          <span v-if="build.completedAt"><strong>Completed:</strong> {{ formatDate(build.completedAt) }}</span>
          <span v-if="build.completedAt"><strong>Duration:</strong> {{ formatDuration(build.createdAt, build.completedAt) }}</span>
          <span><strong>ID:</strong> <code>{{ build.buildId }}</code></span>
        </div>
      </div>

      <!-- Deployed Tools -->
      <div v-if="build.deployedTools.length" class="build-detail__section">
        <h2 class="build-detail__section-title">
          <q-icon name="check_circle" color="positive" size="20px" /> Deployed Tools
        </h2>
        <div class="build-detail__tools">
          <q-btn
            v-for="tool in build.deployedTools"
            :key="tool.toolName"
            flat no-caps
            color="positive"
            :label="tool.toolName"
            icon="build"
            @click="$router.push({ name: 'tool', params: { name: tool.toolName } })"
          />
        </div>
      </div>

      <!-- Workflows -->
      <div v-if="build.workflows.length" class="build-detail__section">
        <h2 class="build-detail__section-title">
          <q-icon name="schedule" color="positive" size="20px" /> Created Workflows
        </h2>
        <div v-for="wf in build.workflows" :key="wf.workflowId" class="build-detail__workflow">
          {{ wf.name }}
        </div>
      </div>

      <!-- QA Results -->
      <div class="build-detail__section">
        <h2 class="build-detail__section-title">
          <q-icon name="verified" size="20px" /> QA Results
        </h2>

        <!-- Smoke Tests -->
        <div v-if="build.qa.smokeTests.length" class="build-detail__qa-group">
          <h3 class="build-detail__qa-label">Smoke Tests</h3>
          <div v-for="st in build.qa.smokeTests" :key="st.toolName" class="build-detail__smoke-test">
            <div class="build-detail__smoke-header">
              <q-icon :name="st.allPassed ? 'check_circle' : 'cancel'" :color="st.allPassed ? 'positive' : 'negative'" size="16px" />
              <span>{{ st.toolName }}</span>
              <span class="build-detail__smoke-count">{{ st.testCases.filter(t => t.passed).length }}/{{ st.testCases.length }} passed</span>
            </div>
            <div v-for="(tc, i) in st.testCases" :key="i" class="build-detail__test-case" :class="{ 'build-detail__test-case--failed': !tc.passed }">
              <q-icon :name="tc.passed ? 'check' : 'close'" :color="tc.passed ? 'positive' : 'negative'" size="14px" />
              <span>{{ tc.description }}</span>
              <div v-if="!tc.passed && tc.error" class="build-detail__test-error">{{ tc.error }}</div>
            </div>
          </div>
        </div>

        <!-- Fidelity Check -->
        <div v-if="build.qa.fidelity" class="build-detail__qa-group">
          <h3 class="build-detail__qa-label">Fidelity Check</h3>
          <div class="build-detail__fidelity">
            <q-icon :name="build.qa.fidelity.pass ? 'check_circle' : 'cancel'" :color="build.qa.fidelity.pass ? 'positive' : 'negative'" size="16px" />
            <span>{{ build.qa.fidelity.reasoning }}</span>
          </div>
          <div v-if="build.qa.fidelity.gaps.length" class="build-detail__gaps">
            <strong>Gaps:</strong>
            <ul>
              <li v-for="(gap, i) in build.qa.fidelity.gaps" :key="i">{{ gap }}</li>
            </ul>
          </div>
        </div>

        <!-- UX Scores -->
        <div v-if="build.qa.uxScores" class="build-detail__qa-group">
          <h3 class="build-detail__qa-label">UX Scores</h3>
          <div class="build-detail__ux-scores">
            <div class="build-detail__ux-score">
              <span class="build-detail__ux-value" :class="scoreClass(build.qa.uxScores.discoverability)">{{ build.qa.uxScores.discoverability }}</span>
              <span class="build-detail__ux-label">Discoverability</span>
            </div>
            <div class="build-detail__ux-score">
              <span class="build-detail__ux-value" :class="scoreClass(build.qa.uxScores.ease_of_use)">{{ build.qa.uxScores.ease_of_use }}</span>
              <span class="build-detail__ux-label">Ease of Use</span>
            </div>
            <div class="build-detail__ux-score">
              <span class="build-detail__ux-value" :class="scoreClass(build.qa.uxScores.result_clarity)">{{ build.qa.uxScores.result_clarity }}</span>
              <span class="build-detail__ux-label">Result Clarity</span>
            </div>
            <div class="build-detail__ux-score">
              <span class="build-detail__ux-value build-detail__ux-value--avg" :class="scoreClass(build.qa.uxScores.average)">{{ build.qa.uxScores.average }}</span>
              <span class="build-detail__ux-label">Average</span>
            </div>
          </div>
          <p v-if="build.qa.uxCritique" class="build-detail__critique">{{ build.qa.uxCritique }}</p>
        </div>

        <!-- UI Definition Issues -->
        <div v-if="build.qa.uiDefinitionIssues?.length" class="build-detail__qa-group">
          <h3 class="build-detail__qa-label">UI Definition Issues</h3>
          <ul class="build-detail__issues">
            <li v-for="(issue, i) in build.qa.uiDefinitionIssues" :key="i">{{ issue }}</li>
          </ul>
        </div>

        <!-- Visual QA Issues -->
        <div v-if="build.qa.visualQaIssues?.length" class="build-detail__qa-group">
          <h3 class="build-detail__qa-label">Visual QA Issues</h3>
          <ul class="build-detail__issues">
            <li v-for="(issue, i) in build.qa.visualQaIssues" :key="i">{{ issue }}</li>
          </ul>
        </div>

        <!-- No QA data -->
        <p v-if="!build.qa.smokeTests.length && !build.qa.fidelity && !build.qa.uxScores" class="build-detail__no-qa">
          No QA data available for this build.
        </p>
      </div>

      <!-- Failure Context -->
      <div v-if="build.failureContext" class="build-detail__section">
        <h2 class="build-detail__section-title">
          <q-icon name="error" color="negative" size="20px" /> Failure Context
        </h2>
        <p v-if="build.failureContext.fidelityReasoning" class="build-detail__failure-reason">
          {{ build.failureContext.fidelityReasoning }}
        </p>
        <div v-if="build.failureContext.fidelityGaps.length" class="build-detail__gaps">
          <strong>Gaps:</strong>
          <ul>
            <li v-for="(gap, i) in build.failureContext.fidelityGaps" :key="i">{{ gap }}</li>
          </ul>
        </div>
      </div>

      <!-- Error -->
      <div v-if="build.error" class="build-detail__section">
        <h2 class="build-detail__section-title">
          <q-icon name="error" color="negative" size="20px" /> Error
        </h2>
        <pre class="build-detail__error-pre">{{ build.error }}</pre>
      </div>

      <!-- Retry Chain -->
      <div v-if="build.parentBuildId || build.resolvedByBuildId" class="build-detail__section">
        <h2 class="build-detail__section-title">
          <q-icon name="account_tree" size="20px" /> Retry Chain
        </h2>
        <div v-if="build.parentBuildId" class="build-detail__chain-link">
          <strong>Parent build:</strong>
          <q-btn flat dense no-caps color="positive" :label="build.parentBuildId.slice(0, 8) + '...'" @click="$router.push({ name: 'build-detail', params: { buildId: build.parentBuildId } })" />
        </div>
        <div v-if="build.resolvedByBuildId" class="build-detail__chain-link">
          <strong>Resolved by:</strong>
          <q-btn flat dense no-caps color="positive" :label="build.resolvedByBuildId.slice(0, 8) + '...'" @click="$router.push({ name: 'build-detail', params: { buildId: build.resolvedByBuildId } })" />
        </div>
      </div>
    </template>
  </q-page>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { WsIncomingMessage } from 'src/types';
import { useBuildsStore } from 'src/stores/builds-store';
import { fableWs } from 'src/boot/websocket';

const route = useRoute();
const router = useRouter();
const buildsStore = useBuildsStore();

const build = computed(() => buildsStore.currentBuild);

let unsubscribe: (() => void) | null = null;
let unwatchConnected: (() => void) | null = null;

function scoreClass(score: number) {
  if (score >= 7) return 'build-detail__ux-value--good';
  if (score >= 6) return 'build-detail__ux-value--ok';
  return 'build-detail__ux-value--bad';
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function formatDuration(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs}s`;
}

function loadBuild() {
  const buildId = route.params.buildId as string;
  if (buildId) {
    buildsStore.fetchBuildDetail(buildId);
  }
}

onMounted(() => {
  unsubscribe = fableWs.onMessage((msg: WsIncomingMessage) => {
    if (msg.type === 'build_detail') {
      buildsStore.handleBuildDetail(msg.payload.build);
    }
    if (msg.type === 'error' && buildsStore.detailLoading) {
      buildsStore.handleError(msg.message || 'Failed to load build');
    }
  });

  if (fableWs.connected.value) {
    loadBuild();
  } else {
    unwatchConnected = watch(fableWs.connected, (isConnected) => {
      if (isConnected) {
        loadBuild();
        unwatchConnected?.();
        unwatchConnected = null;
      }
    });
  }
});

onUnmounted(() => {
  unsubscribe?.();
  unwatchConnected?.();
});

// Reload if route param changes (navigating between builds in retry chain)
watch(() => route.params.buildId, () => {
  if (route.params.buildId) loadBuild();
});
</script>

<style lang="scss" scoped>
.build-detail {
  padding: 24px;
  max-width: 800px;
  margin: 0 auto;

  &__header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 20px;
  }

  &__title {
    font-size: 24px;
    font-weight: 700;
    color: var(--ff-text-primary);
    margin: 0;
  }

  &__loading {
    display: flex;
    justify-content: center;
    padding: 60px 0;
  }

  &__empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 60px 0;
    color: var(--ff-text-muted);
  }

  &__meta {
    background: var(--ff-bg-card);
    border: 1px solid var(--ff-border);
    border-radius: var(--ff-radius-lg);
    padding: 16px;
    margin-bottom: 16px;
  }

  &__meta-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 10px;
  }

  &__status {
    text-transform: uppercase;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.5px;
    padding: 4px 10px;
    border-radius: 2px;
    border: 1px solid;

    &--completed { color: #4ade80; border-color: rgba(74, 222, 128, 0.4); background: rgba(74, 222, 128, 0.1); }
    &--failed { color: #f87171; border-color: rgba(248, 113, 113, 0.4); background: rgba(248, 113, 113, 0.1); }
    &--pending { color: #9ca3af; border-color: rgba(156, 163, 175, 0.4); background: rgba(156, 163, 175, 0.1); }
    &--retrying, &--needs_help { color: #fbbf24; border-color: rgba(251, 191, 36, 0.4); background: rgba(251, 191, 36, 0.1); }
  }

  &__cycle {
    font-size: 12px;
    color: #fbbf24;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  &__request {
    font-size: 15px;
    color: var(--ff-text-primary);
    margin: 0 0 12px;
    line-height: 1.5;
  }

  &__timestamps {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    font-size: 12px;
    color: var(--ff-text-muted);

    code {
      font-size: 11px;
      color: var(--ff-text-secondary);
    }
  }

  &__section {
    background: var(--ff-bg-card);
    border: 1px solid var(--ff-border);
    border-radius: var(--ff-radius-lg);
    padding: 16px;
    margin-bottom: 12px;
  }

  &__section-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--ff-text-primary);
    margin: 0 0 12px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  &__tools {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  &__workflow {
    font-size: 14px;
    color: var(--ff-text-secondary);
    padding: 4px 0;
  }

  &__qa-group {
    margin-bottom: 16px;
    &:last-child { margin-bottom: 0; }
  }

  &__qa-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--ff-text-secondary);
    margin: 0 0 8px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  &__smoke-test {
    margin-bottom: 12px;
  }

  &__smoke-header {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 14px;
    color: var(--ff-text-primary);
    margin-bottom: 6px;
  }

  &__smoke-count {
    font-size: 12px;
    color: var(--ff-text-muted);
    margin-left: auto;
  }

  &__test-case {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    font-size: 13px;
    color: var(--ff-text-secondary);
    padding: 4px 0 4px 22px;

    &--failed { color: #f87171; }
  }

  &__test-error {
    font-size: 12px;
    color: #f87171;
    padding: 4px 0 0 22px;
    font-family: monospace;
  }

  &__fidelity {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 14px;
    color: var(--ff-text-secondary);
  }

  &__gaps {
    font-size: 13px;
    color: var(--ff-text-muted);
    margin-top: 8px;

    ul { margin: 4px 0 0 16px; padding: 0; }
    li { margin: 2px 0; }
  }

  &__ux-scores {
    display: flex;
    gap: 16px;
    margin-bottom: 8px;
  }

  &__ux-score {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 8px;
    border: 1px solid var(--ff-border);
    border-radius: var(--ff-radius-md);
  }

  &__ux-value {
    font-size: 24px;
    font-weight: 700;

    &--good { color: #4ade80; }
    &--ok { color: #fbbf24; }
    &--bad { color: #f87171; }
    &--avg { font-size: 28px; }
  }

  &__ux-label {
    font-size: 10px;
    color: var(--ff-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-top: 2px;
  }

  &__critique {
    font-size: 13px;
    color: var(--ff-text-muted);
    font-style: italic;
    margin: 8px 0 0;
    line-height: 1.5;
  }

  &__issues {
    font-size: 13px;
    color: #f87171;
    margin: 0;
    padding: 0 0 0 16px;

    li { margin: 4px 0; }
  }

  &__no-qa {
    font-size: 13px;
    color: var(--ff-text-muted);
    font-style: italic;
    margin: 0;
  }

  &__failure-reason {
    font-size: 14px;
    color: #f87171;
    margin: 0 0 8px;
    line-height: 1.5;
  }

  &__error-pre {
    font-size: 12px;
    color: #f87171;
    background: rgba(248, 113, 113, 0.05);
    padding: 12px;
    border-radius: var(--ff-radius-md);
    overflow-x: auto;
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
  }

  &__chain-link {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--ff-text-secondary);
    padding: 4px 0;
  }
}
</style>
