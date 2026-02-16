<template>
  <q-page class="tools-page">
    <div class="tools-page__header">
      <div>
        <h1 class="tools-page__title">Tools</h1>
        <p class="tools-page__subtitle">{{ filteredTools.length }} of {{ toolsStore.toolCount }} tools built by FABLE</p>
      </div>
      <q-input
        v-if="toolsStore.tools.length > 0"
        v-model="searchQuery"
        placeholder="Search tools..."
        filled
        dense
        dark
        color="purple"
        class="tools-page__search"
        clearable
      >
        <template #prepend>
          <q-icon name="search" />
        </template>
      </q-input>
    </div>

    <div v-if="toolsStore.loading" class="tools-page__loading">
      <q-spinner-dots color="purple" size="40px" />
    </div>

    <div v-else-if="toolsStore.tools.length === 0" class="tools-page__empty">
      <q-icon name="build" size="48px" color="grey-7" />
      <p>No tools built yet. Ask FABLE to build something!</p>
    </div>

    <div v-else-if="filteredTools.length === 0" class="tools-page__empty">
      <q-icon name="search_off" size="48px" color="grey-7" />
      <p>No tools matching "{{ searchQuery }}"</p>
    </div>

    <div v-else class="tools-page__grid">
      <ToolCard
        v-for="tool in filteredTools"
        :key="tool.name"
        :tool="tool"
        @delete="confirmDelete"
      />
    </div>

    <!-- Delete confirmation dialog -->
    <q-dialog v-model="deleteDialog">
      <q-card class="delete-dialog">
        <q-card-section>
          <div class="text-h6">Delete Tool</div>
        </q-card-section>
        <q-card-section>
          Delete <strong>{{ deleteTarget }}</strong>? This will remove the tool's Lambda function and registration. This cannot be undone.
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn
            flat
            label="Delete"
            color="negative"
            :loading="deleting"
            @click="handleDelete"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useQuasar } from 'quasar';
import { useToolsStore } from 'src/stores/tools-store';
import ToolCard from 'src/components/tools/ToolCard.vue';

const $q = useQuasar();
const toolsStore = useToolsStore();
const deleteDialog = ref(false);
const deleteTarget = ref('');
const deleting = ref(false);
const searchQuery = ref('');

const filteredTools = computed(() => {
  if (!searchQuery.value) return toolsStore.tools;
  const q = searchQuery.value.toLowerCase();
  return toolsStore.tools.filter(t =>
    t.name.toLowerCase().includes(q)
    || t.description.toLowerCase().includes(q)
    || (t.uiDefinition?.title || '').toLowerCase().includes(q)
  );
});

onMounted(() => {
  toolsStore.fetchTools();
});

function confirmDelete(name: string) {
  deleteTarget.value = name;
  deleteDialog.value = true;
}

async function handleDelete() {
  deleting.value = true;
  try {
    await toolsStore.deleteTool(deleteTarget.value);
    deleteDialog.value = false;
    $q.notify({ type: 'positive', message: `Deleted ${deleteTarget.value}` });
  } catch (err) {
    $q.notify({ type: 'negative', message: `Delete failed: ${err}` });
  } finally {
    deleting.value = false;
  }
}
</script>

<style lang="scss" scoped>
.tools-page {
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;

  &__header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    margin-bottom: 24px;
  }

  &__search {
    width: 280px;
    flex-shrink: 0;
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

  &__grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 16px;
  }
}

.delete-dialog {
  background: var(--ff-bg-card);
  min-width: 350px;
}
</style>
