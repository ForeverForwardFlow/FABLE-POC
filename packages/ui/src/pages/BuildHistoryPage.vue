<template>
  <q-page class="builds-page">
    <div class="builds-page__header">
      <h1 class="builds-page__title">Build History</h1>
      <p class="builds-page__subtitle">Past builds, status, and retry info</p>
    </div>

    <!-- Stats Row -->
    <div v-if="buildsStore.builds.length" class="builds-stats">
      <div class="builds-stats__item">
        <span class="builds-stats__value text-positive">{{ buildsStore.completedCount }}</span>
        <span class="builds-stats__label">Completed</span>
      </div>
      <div class="builds-stats__item">
        <span class="builds-stats__value text-negative">{{ buildsStore.failedCount }}</span>
        <span class="builds-stats__label">Failed</span>
      </div>
      <div class="builds-stats__item">
        <span class="builds-stats__value text-amber">{{ buildsStore.activeCount }}</span>
        <span class="builds-stats__label">Active</span>
      </div>
      <div class="builds-stats__item">
        <span class="builds-stats__value">{{ buildsStore.builds.length }}</span>
        <span class="builds-stats__label">Total</span>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="buildsStore.loading && !buildsStore.builds.length" class="builds-page__loading">
      <q-spinner-dots size="40px" color="purple" />
    </div>

    <!-- Error State -->
    <div v-else-if="buildsStore.error" class="builds-page__empty">
      <q-icon name="error_outline" size="48px" color="negative" />
      <p>Failed to load builds</p>
      <q-btn flat no-caps color="purple" label="Retry" icon="refresh" @click="buildsStore.fetchBuilds()" />
    </div>

    <!-- Empty State -->
    <div v-else-if="buildsStore.builds.length === 0" class="builds-page__empty">
      <q-icon name="construction" size="48px" color="grey-7" />
      <p>No builds yet. Ask FABLE to build something!</p>
      <p class="builds-page__hint">
        Try: "Build me a tool that converts temperatures"
      </p>
    </div>

    <!-- Build List -->
    <div v-else class="builds-list">
      <div
        v-for="build in buildsStore.builds"
        :key="build.buildId"
        class="build-card"
      >
        <div class="build-card__header">
          <q-badge
            :color="statusColor(build.status)"
            :label="build.status"
            class="build-card__status"
          />
          <span class="build-card__time">{{ formatTime(build.createdAt) }}</span>
        </div>

        <p class="build-card__request">{{ build.request || 'No description' }}</p>

        <div class="build-card__footer">
          <span class="build-card__id">{{ build.buildId.slice(0, 8) }}...</span>
          <span v-if="build.buildCycle && build.buildCycle > 1" class="build-card__retry">
            <q-icon name="replay" size="12px" />
            Cycle {{ build.buildCycle }}
          </span>
          <span v-if="build.completedAt" class="build-card__duration">
            <q-icon name="timer" size="12px" />
            {{ formatDuration(build.createdAt, build.completedAt) }}
          </span>
        </div>
      </div>
    </div>

    <!-- Refresh -->
    <div v-if="buildsStore.builds.length" class="builds-page__actions">
      <q-btn flat no-caps color="purple" label="Refresh" icon="refresh" @click="buildsStore.fetchBuilds()" :loading="buildsStore.loading" />
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue';
import type { WsIncomingMessage } from 'src/types';
import { useBuildsStore } from 'src/stores/builds-store';
import { fableWs } from 'src/boot/websocket';

const buildsStore = useBuildsStore();

let unsubscribe: (() => void) | null = null;
let unwatchConnected: (() => void) | null = null;

function statusColor(status: string): string {
  const colors: Record<string, string> = {
    completed: 'positive',
    failed: 'negative',
    needs_help: 'orange',
    pending: 'grey',
    retrying: 'amber',
  };
  return colors[status] || 'grey';
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatDuration(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs}s`;
}

function initAfterConnect() {
  buildsStore.fetchBuilds();
}

onMounted(() => {
  unsubscribe = fableWs.onMessage((msg: WsIncomingMessage) => {
    if (msg.type === 'builds_list') {
      buildsStore.handleBuildsList(msg.payload.builds);
    }
    if (msg.type === 'error' && buildsStore.loading) {
      buildsStore.handleError(msg.message || 'Failed to load builds');
    }
  });

  if (fableWs.connected.value) {
    initAfterConnect();
  } else {
    unwatchConnected = watch(fableWs.connected, (isConnected) => {
      if (isConnected) {
        initAfterConnect();
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
</script>

<style lang="scss" scoped>
.builds-page {
  padding: 24px;
  max-width: 800px;
  margin: 0 auto;

  &__header {
    margin-bottom: 24px;
  }

  &__title {
    font-size: 28px;
    font-weight: 700;
    color: var(--ff-text-primary);
    margin: 0 0 4px;
  }

  &__subtitle {
    font-size: 14px;
    color: var(--ff-text-muted);
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

  &__hint {
    font-size: 13px;
    font-style: italic;
    color: var(--ff-text-muted);
    margin: 0;
  }

  &__actions {
    display: flex;
    justify-content: center;
    margin-top: 16px;
  }
}

.builds-stats {
  display: flex;
  gap: 16px;
  margin-bottom: 24px;

  &__item {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 12px;
    background: var(--ff-bg-card);
    border: 1px solid var(--ff-border);
    border-radius: var(--ff-radius-md);
  }

  &__value {
    font-size: 24px;
    font-weight: 700;
  }

  &__label {
    font-size: 11px;
    color: var(--ff-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-top: 2px;
  }
}

.builds-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.build-card {
  background: var(--ff-bg-card);
  border: 1px solid var(--ff-border);
  border-radius: var(--ff-radius-lg);
  padding: 14px 16px;

  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  &__status {
    text-transform: uppercase;
    font-size: 10px;
    letter-spacing: 0.5px;
  }

  &__time {
    font-size: 12px;
    color: var(--ff-text-muted);
  }

  &__request {
    font-size: 14px;
    color: var(--ff-text-primary);
    margin: 0 0 8px;
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  &__footer {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 11px;
    color: var(--ff-text-muted);
  }

  &__id {
    font-family: 'SF Mono', Monaco, monospace;
  }

  &__retry {
    display: flex;
    align-items: center;
    gap: 3px;
    color: var(--q-amber);
  }

  &__duration {
    display: flex;
    align-items: center;
    gap: 3px;
  }
}
</style>
