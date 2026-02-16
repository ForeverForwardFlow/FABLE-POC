import { boot } from 'quasar/wrappers';
import { useAuthStore } from 'src/stores/auth-store';

export default boot(() => {
  const authStore = useAuthStore();
  authStore.restoreSession();
});
