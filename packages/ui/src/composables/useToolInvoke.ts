import { ref } from 'vue';

const MCP_API_URL = import.meta.env.VITE_MCP_API_URL
  || 'https://25d5630rjb.execute-api.us-west-2.amazonaws.com';

export function useToolInvoke() {
  const loading = ref(false);
  const error = ref<string | null>(null);
  const result = ref<unknown>(null);
  const durationMs = ref<number | null>(null);

  async function invoke(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    loading.value = true;
    error.value = null;
    result.value = null;
    durationMs.value = null;

    const start = performance.now();
    try {
      const res = await fetch(`${MCP_API_URL}/tools/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: toolName, arguments: args }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      result.value = data.result;
      return data.result;
    } catch (err) {
      error.value = String(err);
      throw err;
    } finally {
      durationMs.value = Math.round(performance.now() - start);
      loading.value = false;
    }
  }

  function reset(): void {
    loading.value = false;
    error.value = null;
    result.value = null;
    durationMs.value = null;
  }

  return { loading, error, result, durationMs, invoke, reset };
}
