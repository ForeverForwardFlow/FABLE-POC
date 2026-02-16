<template>
  <q-page class="auth-callback">
    <div class="auth-callback__content">
      <q-spinner-dots color="purple" size="40px" />
      <p v-if="error" class="auth-callback__error">{{ error }}</p>
      <p v-else class="auth-callback__text">Signing you in...</p>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from 'src/stores/auth-store';

const router = useRouter();
const authStore = useAuthStore();
const error = ref('');

onMounted(async () => {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const errorParam = params.get('error');

  if (errorParam) {
    error.value = `Login failed: ${errorParam}`;
    setTimeout(() => router.push('/'), 3000);
    return;
  }

  if (!code) {
    error.value = 'No authorization code received';
    setTimeout(() => router.push('/'), 3000);
    return;
  }

  const success = await authStore.handleCallback(code);
  if (success) {
    // Redirect to where user was before login
    const redirectPath = sessionStorage.getItem('pkce_redirect_path') || '/';
    sessionStorage.removeItem('pkce_redirect_path');
    router.push(redirectPath);
  } else {
    error.value = 'Authentication failed. Redirecting...';
    setTimeout(() => router.push('/'), 3000);
  }
});
</script>

<style lang="scss" scoped>
.auth-callback {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 80vh;

  &__content {
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }

  &__text {
    color: var(--ff-text-secondary);
    font-size: 14px;
  }

  &__error {
    color: #ef4444;
    font-size: 14px;
  }
}
</style>
