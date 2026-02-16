<template>
  <q-form @submit.prevent="$emit('submit', formData)" class="dynamic-form">
    <div v-for="field in fields" :key="field.key" class="dynamic-form__field">
      <!-- Text input -->
      <q-input
        v-if="!field.widget || field.widget === 'text'"
        v-model="formData[field.key]"
        :label="field.label || field.key"
        :placeholder="field.placeholder"
        :hint="field.help"
        :rules="isRequired(field.key) ? [requiredRule] : []"
        filled
        dark
        color="purple"
      />

      <!-- Textarea -->
      <q-input
        v-else-if="field.widget === 'textarea'"
        v-model="formData[field.key]"
        :label="field.label || field.key"
        :placeholder="field.placeholder"
        :hint="field.help"
        :rules="isRequired(field.key) ? [requiredRule] : []"
        type="textarea"
        filled
        dark
        color="purple"
        autogrow
        :input-style="{ minHeight: '100px' }"
      />

      <!-- Number input -->
      <q-input
        v-else-if="field.widget === 'number'"
        v-model.number="formData[field.key]"
        :label="field.label || field.key"
        :placeholder="field.placeholder"
        :hint="field.help"
        :rules="isRequired(field.key) ? [requiredRule] : []"
        type="number"
        :min="field.min"
        :max="field.max"
        :step="field.step"
        filled
        dark
        color="purple"
      />

      <!-- Select -->
      <q-select
        v-else-if="field.widget === 'select'"
        v-model="formData[field.key]"
        :label="field.label || field.key"
        :options="field.options || []"
        :hint="field.help"
        :rules="isRequired(field.key) ? [requiredRule] : []"
        option-label="label"
        option-value="value"
        emit-value
        map-options
        filled
        dark
        color="purple"
      />

      <!-- Toggle -->
      <q-toggle
        v-else-if="field.widget === 'toggle'"
        v-model="formData[field.key]"
        :label="field.label || field.key"
        dark
        color="purple"
      />

      <!-- Slider -->
      <div v-else-if="field.widget === 'slider'" class="dynamic-form__slider">
        <div class="dynamic-form__slider-label">{{ field.label || field.key }}: {{ formData[field.key] }}</div>
        <q-slider
          v-model="formData[field.key]"
          :min="field.min || 0"
          :max="field.max || 100"
          :step="field.step || 1"
          dark
          color="purple"
          label
        />
        <div v-if="field.help" class="dynamic-form__help">{{ field.help }}</div>
      </div>
    </div>

    <q-btn
      type="submit"
      :label="submitLabel"
      color="purple"
      :loading="loading"
      no-caps
      class="dynamic-form__submit"
    />
  </q-form>
</template>

<script setup lang="ts">
import { reactive, computed, watch } from 'vue';
import type { ToolUIDefinition } from 'src/types';

const props = defineProps<{
  uiDefinition?: ToolUIDefinition;
  inputSchema?: Record<string, unknown>;
  loading?: boolean;
}>();

defineEmits<{
  (e: 'submit', data: Record<string, unknown>): void;
}>();

const requiredRule = (val: unknown) => (val !== null && val !== undefined && val !== '') || 'Required';

const fields = computed(() => {
  if (props.uiDefinition?.form?.fields) {
    return props.uiDefinition.form.fields;
  }
  // Auto-generate from inputSchema
  const properties = (props.inputSchema?.properties || {}) as Record<string, Record<string, unknown>>;
  return Object.entries(properties).map(([key, prop]) => ({
    key,
    label: (prop.description as string) || key,
    widget: inferWidget(prop.type as string) as 'text' | 'textarea' | 'number',
    placeholder: '',
  }));
});

const submitLabel = computed(() => props.uiDefinition?.form?.submitLabel || 'Run');

function inferWidget(type: string): string {
  switch (type) {
    case 'number':
    case 'integer':
      return 'number';
    case 'boolean':
      return 'toggle';
    default:
      return 'text';
  }
}

function isRequired(key: string): boolean {
  const required = (props.inputSchema?.required || []) as string[];
  return required.includes(key);
}

const formData = reactive<Record<string, unknown>>({});

// Initialize defaults
watch(fields, (f) => {
  for (const field of f) {
    if (formData[field.key] === undefined) {
      formData[field.key] = field.defaultValue ?? (field.widget === 'toggle' ? false : '');
    }
  }
}, { immediate: true });

function fillExample(input: Record<string, unknown>): void {
  // Reset all fields to defaults first, then apply example values
  for (const field of fields.value) {
    formData[field.key] = field.defaultValue ?? (field.widget === 'toggle' ? false : '');
  }
  Object.assign(formData, input);
}

defineExpose({ fillExample, formData });
</script>

<style lang="scss" scoped>
.dynamic-form {
  display: flex;
  flex-direction: column;
  gap: 16px;

  &__field {
    width: 100%;
  }

  &__slider {
    padding: 8px 0;
  }

  &__slider-label {
    font-size: 14px;
    color: var(--ff-text-secondary);
    margin-bottom: 8px;
  }

  &__help {
    font-size: 12px;
    color: var(--ff-text-muted);
    margin-top: 4px;
  }

  &__submit {
    align-self: flex-start;
    margin-top: 8px;
  }
}
</style>
