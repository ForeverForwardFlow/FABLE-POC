<template>
  <q-page class="settings-page">
    <div class="settings-page__header">
      <h1 class="settings-page__title">Settings</h1>
      <p class="settings-page__subtitle">Profile, preferences, and display</p>
    </div>

    <!-- Profile Section -->
    <section class="settings-section">
      <h2 class="settings-section__title">
        <q-icon name="person" size="20px" class="q-mr-sm" />
        Profile
      </h2>
      <div class="settings-card">
        <template v-if="authStore.isAuthenticated">
          <div class="profile-row">
            <span class="profile-row__label">Email</span>
            <span class="profile-row__value">{{ authStore.user?.email }}</span>
          </div>
          <q-separator dark class="q-my-sm" />
          <div class="profile-row">
            <span class="profile-row__label">Organization</span>
            <span class="profile-row__value">{{ authStore.user?.orgId || 'default' }}</span>
          </div>
          <q-separator dark class="q-my-sm" />
          <div class="profile-row">
            <span class="profile-row__label">Session</span>
            <span class="profile-row__value">
              <q-badge :color="authStore.isExpired ? 'negative' : 'positive'" :label="authStore.isExpired ? 'Expired' : 'Active'" />
            </span>
          </div>
          <div class="settings-card__actions">
            <q-btn flat no-caps color="negative" label="Sign out" icon="logout" @click="authStore.logout()" />
          </div>
        </template>
        <template v-else>
          <div class="settings-card__empty">
            <q-icon name="person_outline" size="32px" color="grey-7" />
            <p>Sign in to manage your profile</p>
            <q-btn flat no-caps color="purple" label="Sign in" @click="authStore.login()" />
          </div>
        </template>
      </div>
    </section>

    <!-- What FABLE Remembers -->
    <section class="settings-section">
      <h2 class="settings-section__title">
        <q-icon name="psychology" size="20px" class="q-mr-sm" />
        What FABLE Remembers
      </h2>
      <div class="settings-card">
        <p class="settings-card__description">
          FABLE learns your preferences and context over time to provide a personalized experience.
          Preferences are saved automatically during conversations.
        </p>

        <div v-if="memoriesLoading" class="settings-card__loading">
          <q-spinner-dots size="24px" color="purple" />
          <span>Loading memories...</span>
        </div>

        <div v-else-if="memories.length === 0" class="settings-card__empty">
          <q-icon name="lightbulb_outline" size="32px" color="grey-7" />
          <p>No memories yet. FABLE will learn about you as you chat!</p>
        </div>

        <q-list v-else dense class="memory-list">
          <q-item v-for="mem in memories" :key="mem.id" class="memory-item">
            <q-item-section avatar>
              <q-icon :name="memoryIcon(mem.type)" :color="memoryColor(mem.type)" size="18px" />
            </q-item-section>
            <q-item-section>
              <q-item-label class="memory-item__content">{{ mem.content }}</q-item-label>
              <q-item-label caption>
                <q-badge :label="mem.type" outline :color="memoryColor(mem.type)" class="q-mr-xs" />
                {{ formatDate(mem.createdAt) }}
              </q-item-label>
            </q-item-section>
            <q-item-section side>
              <q-btn
                flat dense round
                icon="delete_outline"
                size="sm"
                color="grey-6"
                class="memory-item__delete"
                @click="deleteMemory(mem.id)"
                :loading="deletingIds.has(mem.id)"
              />
            </q-item-section>
          </q-item>
        </q-list>

        <div v-if="memories.length > 0" class="settings-card__actions">
          <q-btn flat no-caps dense color="purple" label="Refresh" icon="refresh" @click="loadMemories" :loading="memoriesLoading" />
        </div>
      </div>
    </section>

    <!-- Tool Approval Section -->
    <section class="settings-section">
      <h2 class="settings-section__title">
        <q-icon name="shield" size="20px" class="q-mr-sm" />
        Tool Approval
      </h2>
      <div class="settings-card">
        <p class="settings-card__description">
          When enabled, FABLE will ask for your approval before using external tools during conversations.
        </p>
        <div class="profile-row">
          <span class="profile-row__label">Require tool approval</span>
          <span class="profile-row__value">
            <q-toggle
              :model-value="chatStore.requireToolApproval"
              @update:model-value="chatStore.setRequireToolApproval($event)"
              color="purple"
              dense
            />
          </span>
        </div>

        <template v-if="chatStore.alwaysApprovedTools.length > 0">
          <q-separator dark class="q-my-sm" />
          <div class="tool-section-label">Always allowed tools</div>
          <q-list dense class="approved-tools-list">
            <q-item v-for="tool in chatStore.alwaysApprovedTools" :key="tool" class="approved-tool-item">
              <q-item-section avatar>
                <q-icon name="verified" color="positive" size="18px" />
              </q-item-section>
              <q-item-section>
                <q-item-label class="approved-tool-name">{{ tool }}</q-item-label>
              </q-item-section>
              <q-item-section side>
                <q-btn
                  flat dense round
                  icon="close"
                  size="sm"
                  color="grey-6"
                  @click="chatStore.removeAlwaysApproved(tool)"
                />
              </q-item-section>
            </q-item>
          </q-list>
        </template>
      </div>
    </section>

    <!-- Display Section -->
    <section class="settings-section">
      <h2 class="settings-section__title">
        <q-icon name="palette" size="20px" class="q-mr-sm" />
        Display
      </h2>
      <div class="settings-card">
        <div class="profile-row">
          <span class="profile-row__label">Theme</span>
          <span class="profile-row__value">
            <q-badge color="grey-8" label="Dark" />
            <span class="text-caption q-ml-sm" style="color: var(--ff-text-muted)">Light theme coming soon</span>
          </span>
        </div>
      </div>
    </section>

    <!-- About Section -->
    <section class="settings-section">
      <h2 class="settings-section__title">
        <q-icon name="info" size="20px" class="q-mr-sm" />
        About
      </h2>
      <div class="settings-card">
        <div class="profile-row">
          <span class="profile-row__label">Version</span>
          <span class="profile-row__value">FABLE v0.1.0</span>
        </div>
        <q-separator dark class="q-my-sm" />
        <div class="profile-row">
          <span class="profile-row__label">Tools deployed</span>
          <span class="profile-row__value">{{ toolCount }}</span>
        </div>
        <q-separator dark class="q-my-sm" />
        <div class="profile-row">
          <span class="profile-row__label">WebSocket</span>
          <span class="profile-row__value">
            <q-badge :color="fableWs.connected.value ? 'positive' : 'negative'" :label="fableWs.connectionState.value" />
          </span>
        </div>
      </div>
    </section>
  </q-page>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted, watch } from 'vue';
import { useQuasar } from 'quasar';
import { useAuthStore } from 'src/stores/auth-store';
import { useChatStore } from 'src/stores/chat-store';
import { fableWs } from 'src/boot/websocket';
import type { WsIncomingMessage, MemoryRecord } from 'src/types';

const $q = useQuasar();
const authStore = useAuthStore();
const chatStore = useChatStore();

const MCP_API = import.meta.env.VITE_MCP_API_URL || 'https://25d5630rjb.execute-api.us-west-2.amazonaws.com';

// Tool count
const toolCount = ref(0);

// Memories
const memories = ref<MemoryRecord[]>([]);
const memoriesLoading = ref(false);
const deletingIds = reactive(new Set<string>());

let unsubscribe: (() => void) | null = null;
let unwatchConnected: (() => void) | null = null;

function memoryIcon(type: string): string {
  const icons: Record<string, string> = {
    preference: 'favorite',
    insight: 'lightbulb',
    gotcha: 'warning',
    pattern: 'auto_awesome',
    capability: 'extension',
    status: 'schedule',
  };
  return icons[type] || 'memory';
}

function memoryColor(type: string): string {
  const colors: Record<string, string> = {
    preference: 'pink',
    insight: 'amber',
    gotcha: 'orange',
    pattern: 'teal',
    capability: 'purple',
    status: 'blue',
  };
  return colors[type] || 'grey';
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

async function loadToolCount() {
  try {
    const res = await fetch(`${MCP_API}/tools`);
    if (res.ok) {
      const data = await res.json();
      toolCount.value = Array.isArray(data.tools) ? data.tools.length : 0;
    }
  } catch {
    // ignore
  }
}

function loadMemories() {
  memoriesLoading.value = true;
  fableWs.send({ type: 'list_memories' });
}

function deleteMemory(id: string) {
  deletingIds.add(id);
  fableWs.send({ type: 'delete_memory', payload: { memoryId: id } });
}

function initAfterConnect() {
  loadMemories();
  loadToolCount();
}

onMounted(() => {
  unsubscribe = fableWs.onMessage((msg: WsIncomingMessage) => {
    if (msg.type === 'memories_list') {
      memories.value = msg.payload.memories;
      memoriesLoading.value = false;
    }
    if (msg.type === 'memory_deleted') {
      deletingIds.delete(msg.payload.memoryId);
      if (msg.payload.success) {
        memories.value = memories.value.filter(m => m.id !== msg.payload.memoryId);
        $q.notify({ type: 'positive', message: 'Memory deleted' });
      } else {
        $q.notify({ type: 'negative', message: 'Failed to delete memory' });
      }
    }
  });

  if (fableWs.connected.value) {
    initAfterConnect();
  } else {
    loadToolCount(); // This doesn't need WS
    unwatchConnected = watch(fableWs.connected, (isConnected) => {
      if (isConnected) {
        loadMemories();
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
.settings-page {
  padding: 24px;
  max-width: 640px;
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
}

.settings-section {
  margin-bottom: 24px;

  &__title {
    display: flex;
    align-items: center;
    font-size: 16px;
    font-weight: 600;
    color: var(--ff-text-primary);
    margin: 0 0 12px;
  }
}

.settings-card {
  background: var(--ff-bg-card);
  border: 1px solid var(--ff-border);
  border-radius: var(--ff-radius-lg);
  padding: 16px;

  &__description {
    font-size: 13px;
    color: var(--ff-text-secondary);
    margin: 0 0 12px;
    line-height: 1.5;
  }

  &__loading {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 16px 0;
    font-size: 13px;
    color: var(--ff-text-secondary);
  }

  &__empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 24px 0;
    color: var(--ff-text-muted);
    font-size: 14px;

    p {
      margin: 0;
    }
  }

  &__actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--ff-border);
  }
}

.profile-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;

  &__label {
    font-size: 13px;
    font-weight: 500;
    color: var(--ff-text-secondary);
  }

  &__value {
    font-size: 13px;
    color: var(--ff-text-primary);
    display: flex;
    align-items: center;
  }
}

.memory-list {
  max-height: 400px;
  overflow-y: auto;
}

.memory-item {
  border-radius: var(--ff-radius-sm);
  margin-bottom: 2px;
  padding: 8px;

  &__content {
    font-size: 13px;
    color: var(--ff-text-primary);
    line-height: 1.4;
  }

  &__delete {
    opacity: 0;
    transition: opacity 0.15s;
  }

  &:hover .memory-item__delete {
    opacity: 1;
  }
}

.tool-section-label {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--ff-text-muted);
  margin-bottom: 4px;
}

.approved-tool-name {
  font-size: 13px;
  color: var(--ff-text-primary);
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}
</style>
