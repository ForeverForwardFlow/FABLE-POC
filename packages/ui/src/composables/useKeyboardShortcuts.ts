import { onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useChatStore } from 'src/stores/chat-store';

export function useKeyboardShortcuts() {
  const router = useRouter();
  const chatStore = useChatStore();

  function handleKeydown(e: KeyboardEvent) {
    const meta = e.metaKey || e.ctrlKey;
    if (!meta) return;

    // Cmd+N — new conversation
    if (e.key === 'n' && !e.shiftKey) {
      // Don't capture if user is typing in an input
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      e.preventDefault();
      chatStore.newConversation();
      router.push({ name: 'chat' });
    }

    // Cmd+K — quick nav (focus search or go to chat)
    if (e.key === 'k') {
      e.preventDefault();
      router.push({ name: 'chat' });
      // Focus will be handled by ChatInput's onMounted
    }

    // Cmd+, — settings
    if (e.key === ',') {
      e.preventDefault();
      router.push({ name: 'settings' });
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', handleKeydown);
  });

  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeydown);
  });
}
