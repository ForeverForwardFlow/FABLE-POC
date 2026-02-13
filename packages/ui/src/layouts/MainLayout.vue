<template>
  <q-layout view="hHh lpR fFf">
    <!-- Header -->
    <q-header class="bg-dark">
      <q-toolbar>
        <q-btn flat dense round icon="menu" @click="uiStore.toggleSidebar" class="lt-md" />
        <q-toolbar-title class="text-weight-bold text-purple">
          FABLE
        </q-toolbar-title>
        <q-btn flat dense round icon="settings" />
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
      <ProjectList />
    </q-drawer>

    <!-- Main Content -->
    <q-page-container>
      <router-view />
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useUIStore } from 'src/stores/ui-store';
import ProjectList from 'src/components/sidebar/ProjectList.vue';

const uiStore = useUIStore();

const sidebarOpen = computed({
  get: () => uiStore.sidebarOpen,
  set: (val) => {
    if (val !== uiStore.sidebarOpen) {
      uiStore.toggleSidebar();
    }
  }
});
</script>

<style lang="scss" scoped>
.text-purple {
  color: var(--ff-purple);
}
</style>
