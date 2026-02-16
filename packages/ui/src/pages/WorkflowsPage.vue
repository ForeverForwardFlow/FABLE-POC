<template>
  <q-page class="workflows-page">
    <div class="workflows-page__header">
      <h1 class="workflows-page__title">Workflows</h1>
      <p class="workflows-page__subtitle">Automated tasks powered by your tools</p>
    </div>

    <div v-if="workflowsStore.loading && !workflowsStore.workflows.length" class="workflows-page__loading">
      <q-spinner-dots size="40px" color="purple" />
    </div>

    <div v-else-if="workflowsStore.workflows.length === 0" class="workflows-page__empty">
      <q-icon name="schedule" size="48px" color="grey-7" />
      <p>No workflows yet. Ask FABLE to create a workflow!</p>
      <p class="workflows-page__hint">
        Try: "Create a daily workflow that summarizes the latest tool usage"
      </p>
    </div>

    <div v-else class="workflows-page__list">
      <WorkflowCard
        v-for="wf in workflowsStore.workflows"
        :key="wf.workflowId"
        :workflow="wf"
        @run="handleRun"
        @toggle-pause="handleTogglePause"
        @delete="confirmDelete"
      />
    </div>

    <!-- Delete confirmation dialog -->
    <q-dialog v-model="deleteDialog" persistent>
      <q-card class="delete-dialog" dark>
        <q-card-section>
          <div class="text-h6">Delete workflow?</div>
          <div class="text-body2 q-mt-sm" style="color: var(--ff-text-secondary)">
            This will permanently delete <strong>{{ deleteTarget?.name }}</strong>.
            Any scheduled runs will be cancelled.
          </div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat no-caps label="Cancel" color="grey" v-close-popup />
          <q-btn
            flat
            no-caps
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
import { ref, onMounted } from 'vue';
import { useQuasar } from 'quasar';
import type { WorkflowDefinition } from 'src/types';
import { useWorkflowsStore } from 'src/stores/workflows-store';
import WorkflowCard from 'src/components/workflows/WorkflowCard.vue';

const $q = useQuasar();
const workflowsStore = useWorkflowsStore();

const deleteDialog = ref(false);
const deleteTarget = ref<WorkflowDefinition | null>(null);
const deleting = ref(false);

onMounted(() => {
  workflowsStore.fetchWorkflows();
});

async function handleRun(wf: WorkflowDefinition) {
  try {
    await workflowsStore.runWorkflow(wf.workflowId, wf.orgId);
    $q.notify({ type: 'positive', message: `Triggered "${wf.name}"` });
  } catch (err) {
    $q.notify({ type: 'negative', message: `Run failed: ${err}` });
  }
}

async function handleTogglePause(wf: WorkflowDefinition) {
  const newStatus = wf.status === 'active' ? 'paused' : 'active';
  try {
    await workflowsStore.togglePause(wf.workflowId, wf.orgId, newStatus);
    $q.notify({
      type: 'positive',
      message: newStatus === 'paused' ? `Paused "${wf.name}"` : `Resumed "${wf.name}"`,
    });
  } catch (err) {
    $q.notify({ type: 'negative', message: `Status update failed: ${err}` });
  }
}

function confirmDelete(wf: WorkflowDefinition) {
  deleteTarget.value = wf;
  deleteDialog.value = true;
}

async function handleDelete() {
  if (!deleteTarget.value) return;
  deleting.value = true;
  try {
    await workflowsStore.deleteWorkflow(deleteTarget.value.workflowId, deleteTarget.value.orgId);
    deleteDialog.value = false;
    $q.notify({ type: 'positive', message: `Deleted "${deleteTarget.value.name}"` });
  } catch (err) {
    $q.notify({ type: 'negative', message: `Delete failed: ${err}` });
  } finally {
    deleting.value = false;
  }
}
</script>

<style lang="scss" scoped>
.workflows-page {
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

  &__list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
}

.delete-dialog {
  background: var(--ff-bg-card);
  min-width: 350px;
}
</style>
