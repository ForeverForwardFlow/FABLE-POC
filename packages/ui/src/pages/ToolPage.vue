<template>
  <q-page class="tool-page">
    <div v-if="toolsStore.loading && !tool" class="tool-page__loading">
      <q-spinner-dots color="purple" size="40px" />
    </div>

    <div v-else-if="!tool" class="tool-page__not-found">
      <q-icon name="search_off" size="48px" color="grey-7" />
      <h2>Tool not found</h2>
      <p>No tool named "{{ toolName }}" exists.</p>
      <q-btn flat no-caps color="purple" label="Back to Tools" icon="arrow_back" :to="{ name: 'tools' }" />
    </div>

    <template v-else>
      <!-- Header -->
      <div class="tool-page__header">
        <q-btn flat round icon="arrow_back" color="grey" @click="$router.push({ name: 'tools' })" />
        <q-icon :name="iconName" size="36px" color="purple" />
        <div class="tool-page__header-text">
          <h1 class="tool-page__title">{{ displayTitle }}</h1>
          <p v-if="tool.uiDefinition?.subtitle" class="tool-page__subtitle">{{ tool.uiDefinition.subtitle }}</p>
          <p v-else class="tool-page__subtitle">{{ tool.description }}</p>
        </div>
        <q-space />
        <q-btn
          flat round
          icon="delete_outline"
          color="grey-6"
          @click="confirmDelete"
        >
          <q-tooltip>Delete tool</q-tooltip>
        </q-btn>
      </div>

      <div class="tool-page__content">
        <!-- Input Form -->
        <div class="tool-page__form-section">
          <DynamicForm
            ref="formRef"
            :ui-definition="tool.uiDefinition"
            :input-schema="tool.inputSchema"
            :loading="invoker.loading.value"
            @submit="handleSubmit"
          />

          <!-- Example buttons -->
          <div v-if="tool.uiDefinition?.examples?.length" class="tool-page__examples">
            <span class="tool-page__examples-label">Try it:</span>
            <q-btn
              v-for="(example, i) in tool.uiDefinition.examples"
              :key="i"
              :label="example.label"
              outline
              no-caps
              size="sm"
              color="purple"
              @click="fillExample(example.input)"
            />
          </div>
        </div>

        <!-- Results -->
        <div v-if="invoker.error.value" class="tool-page__error">
          <q-icon name="error" color="negative" />
          <span>{{ invoker.error.value }}</span>
        </div>

        <div v-if="invoker.result.value" class="tool-page__result">
          <div class="tool-page__result-header">
            <h3 class="tool-page__result-title">Result</h3>
            <div class="tool-page__result-meta">
              <span v-if="invoker.durationMs.value" class="tool-page__timing">
                <q-icon name="timer" size="14px" />
                {{ invoker.durationMs.value }}ms
              </span>
              <q-btn
                flat round dense
                icon="content_copy"
                size="sm"
                color="grey"
                @click="copyResult"
              >
                <q-tooltip>Copy JSON</q-tooltip>
              </q-btn>
            </div>
          </div>
          <ResultRenderer
            :result="invoker.result.value"
            :ui-definition="tool.uiDefinition"
          />
        </div>
      </div>
    </template>

    <!-- Delete confirmation dialog -->
    <q-dialog v-model="deleteDialog">
      <q-card class="delete-dialog">
        <q-card-section>
          <div class="text-h6">Delete Tool</div>
        </q-card-section>
        <q-card-section>
          Delete <strong>{{ toolName }}</strong>? This will remove the tool's Lambda function and registration. This cannot be undone.
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
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import { useToolsStore } from 'src/stores/tools-store';
import { useToolInvoke } from 'src/composables/useToolInvoke';
import DynamicForm from 'src/components/tools/DynamicForm.vue';
import ResultRenderer from 'src/components/tools/ResultRenderer.vue';

const route = useRoute();
const router = useRouter();
const $q = useQuasar();
const toolsStore = useToolsStore();
const invoker = useToolInvoke();
const formRef = ref<InstanceType<typeof DynamicForm> | null>(null);
const deleteDialog = ref(false);
const deleting = ref(false);

const toolName = computed(() => route.params.name as string);
const tool = computed(() => toolsStore.getToolByName(toolName.value));
const iconName = computed(() => tool.value?.uiDefinition?.icon || 'build');
const displayTitle = computed(() => {
  if (tool.value?.uiDefinition?.title) return tool.value.uiDefinition.title;
  return toolName.value.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
});

onMounted(() => {
  toolsStore.fetchTools();
});

function handleSubmit(data: Record<string, unknown>): void {
  invoker.invoke(toolName.value, data);
}

function fillExample(input: Record<string, unknown>): void {
  formRef.value?.fillExample(input);
}

function copyResult() {
  const json = JSON.stringify(invoker.result.value, null, 2);
  navigator.clipboard.writeText(json).then(() => {
    $q.notify({ type: 'positive', message: 'Copied to clipboard', timeout: 1500 });
  });
}

function confirmDelete() {
  deleteDialog.value = true;
}

async function handleDelete() {
  deleting.value = true;
  try {
    await toolsStore.deleteTool(toolName.value);
    deleteDialog.value = false;
    $q.notify({ type: 'positive', message: `Deleted ${toolName.value}` });
    router.push({ name: 'tools' });
  } catch (err) {
    $q.notify({ type: 'negative', message: `Delete failed: ${err}` });
  } finally {
    deleting.value = false;
  }
}
</script>

<style lang="scss" scoped>
.tool-page {
  padding: 24px;
  max-width: 800px;
  margin: 0 auto;

  &__loading {
    display: flex;
    justify-content: center;
    padding: 60px 0;
  }

  &__not-found {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 60px 0;
    text-align: center;
    color: var(--ff-text-secondary);

    h2 {
      font-size: 20px;
      font-weight: 600;
      color: var(--ff-text-primary);
      margin: 8px 0 0;
    }

    p {
      font-size: 14px;
      margin: 0;
    }
  }

  &__header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 32px;

    h1 {
      margin: 0;
    }
  }

  &__title {
    font-size: 24px;
    font-weight: 700;
    color: var(--ff-text-primary);
  }

  &__subtitle {
    font-size: 14px;
    color: var(--ff-text-muted);
    margin: 4px 0 0;
  }

  &__content {
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  &__form-section {
    background: var(--ff-bg-secondary);
    border: 1px solid var(--ff-border);
    border-radius: var(--ff-radius-lg);
    padding: 24px;
  }

  &__examples {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 16px;
    flex-wrap: wrap;
  }

  &__examples-label {
    font-size: 13px;
    color: var(--ff-text-muted);
  }

  &__error {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: var(--ff-radius-md);
    color: var(--ff-text-primary);
    font-size: 14px;
  }

  &__result {
    background: var(--ff-bg-secondary);
    border: 1px solid var(--ff-border);
    border-radius: var(--ff-radius-lg);
    padding: 24px;
  }

  &__result-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  }

  &__result-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--ff-text-primary);
    margin: 0;
  }

  &__result-meta {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  &__timing {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: var(--ff-text-muted);
  }

  &__header-text {
    flex: 1;
    min-width: 0;
  }
}

.delete-dialog {
  background: var(--ff-bg-card);
  min-width: 350px;
}
</style>
