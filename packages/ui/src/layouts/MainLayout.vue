<template>
  <q-layout view="hHh lpR fFf">
    <!-- Header -->
    <q-header class="bg-dark">
      <q-toolbar>
        <q-btn flat dense round icon="menu" @click="uiStore.toggleSidebar" class="lt-md" />
        <q-toolbar-title class="text-weight-bold text-purple">
          FABLE
        </q-toolbar-title>
        <transition name="fade">
          <div v-if="fableWs.connectionState.value !== 'connected'" class="connection-status">
            <q-spinner-dots v-if="fableWs.connectionState.value === 'reconnecting'" size="14px" color="amber" />
            <q-icon v-else name="cloud_off" size="14px" color="negative" />
            <span class="connection-status__text">
              {{ fableWs.connectionState.value === 'reconnecting' ? 'Reconnecting...' : 'Disconnected' }}
            </span>
          </div>
        </transition>
        <q-btn flat dense round icon="settings" />
        <template v-if="authStore.isAuthenticated">
          <q-btn flat dense no-caps class="q-ml-sm">
            <q-avatar size="28px" color="purple" text-color="white" class="q-mr-xs">
              {{ authStore.user?.email?.[0]?.toUpperCase() || '?' }}
            </q-avatar>
            <q-menu dark>
              <q-list style="min-width: 200px">
                <q-item-label header>{{ authStore.user?.email }}</q-item-label>
                <q-separator dark />
                <q-item clickable v-close-popup @click="authStore.logout()">
                  <q-item-section avatar><q-icon name="logout" /></q-item-section>
                  <q-item-section>Sign out</q-item-section>
                </q-item>
              </q-list>
            </q-menu>
          </q-btn>
        </template>
        <q-btn v-else flat dense no-caps label="Sign in" color="purple" @click="authStore.login()" />
      </q-toolbar>
    </q-header>

    <!-- Sidebar -->
    <q-drawer
      v-model="sidebarOpen"
      show-if-above
      :width="240"
      :breakpoint="768"
      class="ff-sidebar"
    >
      <!-- Navigation -->
      <q-list class="sidebar-nav">
        <q-item
          v-for="item in navItems"
          :key="item.name"
          :to="{ name: item.name }"
          clickable
          v-ripple
          :active="$route.name === item.name || ($route.name === 'chat-conversation' && item.name === 'chat')"
          active-class="sidebar-nav__active"
        >
          <q-item-section avatar>
            <q-icon :name="item.icon" />
          </q-item-section>
          <q-item-section>{{ item.label }}</q-item-section>
        </q-item>
      </q-list>

      <q-separator class="q-mx-md" dark />

      <!-- Conversations History -->
      <div class="conversations-section">
        <div class="conversations-section__header">
          <span class="conversations-section__title">Conversations</span>
          <q-btn
            flat dense round
            icon="add"
            size="sm"
            color="purple"
            @click="startNewConversation"
          />
        </div>

        <q-input
          v-if="conversationsStore.conversations.length > 3"
          v-model="conversationSearch"
          dense outlined
          placeholder="Search..."
          class="conversations-section__search"
          clearable
          dark
        >
          <template #prepend>
            <q-icon name="search" size="16px" />
          </template>
        </q-input>

        <q-list v-if="filteredConversations.length" dense class="conversation-list">
          <q-item
            v-for="conv in filteredConversations"
            :key="conv.conversationId"
            clickable
            v-ripple
            :active="chatStore.conversationId === conv.conversationId"
            active-class="sidebar-nav__active"
            class="conversation-item"
            @click="openConversation(conv.conversationId)"
          >
            <q-item-section>
              <q-item-label class="conversation-item__title" lines="1">
                {{ conv.title || 'New conversation' }}
              </q-item-label>
              <q-item-label caption class="conversation-item__time">
                {{ formatTime(conv.updatedAt) }}
              </q-item-label>
            </q-item-section>
            <q-item-section side>
              <q-btn
                flat dense round
                icon="close"
                size="xs"
                color="grey-6"
                class="conversation-item__delete"
                @click.stop="confirmDelete(conv.conversationId)"
              />
            </q-item-section>
          </q-item>
        </q-list>

        <div v-else-if="conversationSearch && conversationsStore.conversations.length" class="conversations-section__empty">
          No matches
        </div>
        <div v-else-if="!conversationsStore.loading" class="conversations-section__empty">
          No conversations yet
        </div>
      </div>
    </q-drawer>

    <!-- Main Content -->
    <q-page-container>
      <ErrorBoundary>
        <router-view />
      </ErrorBoundary>
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useUIStore } from 'src/stores/ui-store';
import { useChatStore } from 'src/stores/chat-store';
import { useConversationsStore } from 'src/stores/conversations-store';
import { useAuthStore } from 'src/stores/auth-store';
import { fableWs } from 'src/boot/websocket';
import ErrorBoundary from 'src/components/ErrorBoundary.vue';

const router = useRouter();
const uiStore = useUIStore();
const chatStore = useChatStore();
const conversationsStore = useConversationsStore();
const authStore = useAuthStore();

const sidebarOpen = computed({
  get: () => uiStore.sidebarOpen,
  set: (val) => {
    if (val !== uiStore.sidebarOpen) {
      uiStore.toggleSidebar();
    }
  }
});

const conversationSearch = ref('');

const filteredConversations = computed(() => {
  const query = (conversationSearch.value || '').toLowerCase().trim();
  if (!query) return conversationsStore.conversations;
  return conversationsStore.conversations.filter(
    c => (c.title || '').toLowerCase().includes(query)
  );
});

const navItems = [
  { name: 'chat', label: 'Chat', icon: 'chat' },
  { name: 'tools', label: 'Tools', icon: 'build' },
  { name: 'workflows', label: 'Workflows', icon: 'schedule' },
];

function startNewConversation() {
  chatStore.newConversation();
  router.push({ name: 'chat' });
}

function openConversation(conversationId: string) {
  chatStore.loadConversation(conversationId);
  router.push({ name: 'chat-conversation', params: { conversationId } });
}

function confirmDelete(conversationId: string) {
  conversationsStore.deleteConversation(conversationId);
  // If deleting the active conversation, start fresh
  if (chatStore.conversationId === conversationId) {
    chatStore.newConversation();
    router.push({ name: 'chat' });
  }
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}
</script>

<style lang="scss" scoped>
.text-purple {
  color: var(--ff-purple);
}

.connection-status {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.08);
  margin-right: 8px;
  font-size: 12px;

  &__text {
    color: var(--ff-text-secondary);
  }
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.sidebar-nav {
  padding: 16px 8px 8px;

  .q-item {
    border-radius: var(--ff-radius-sm);
    margin-bottom: 4px;
    color: var(--ff-text-secondary);

    &:hover {
      background: var(--ff-bg-tertiary);
    }
  }

  &__active {
    background: rgba(168, 85, 247, 0.15) !important;
    color: var(--ff-purple-light) !important;
  }
}

.conversations-section {
  padding: 12px 8px;

  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 8px 8px;
  }

  &__title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--ff-text-secondary);
  }

  &__search {
    padding: 0 8px 8px;

    :deep(.q-field__control) {
      height: 32px;
    }
    :deep(.q-field__marginal) {
      height: 32px;
    }
  }

  &__empty {
    padding: 16px 8px;
    text-align: center;
    font-size: 13px;
    color: var(--ff-text-secondary);
  }
}

.conversation-list {
  .q-item {
    border-radius: var(--ff-radius-sm);
    margin-bottom: 2px;
    min-height: 48px;
    padding: 4px 8px;
  }
}

.conversation-item {
  &__title {
    font-size: 13px;
    color: var(--ff-text-primary);
  }

  &__time {
    font-size: 11px;
    color: var(--ff-text-secondary);
  }

  &__delete {
    opacity: 0;
    transition: opacity 0.15s;
  }

  &:hover .conversation-item__delete {
    opacity: 1;
  }
}
</style>
