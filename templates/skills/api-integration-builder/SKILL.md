---
name: api-integration-builder
description: >
  Builds tools that connect to external APIs (weather, stocks, CRM, translation, etc.).
  Use when the build request mentions API, integration, external service, fetch data from,
  connect to, or references a specific third-party service.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# API Integration Builder

You are building a Lambda tool that connects to an external API. This extends the basic tool pattern with HTTP client handling, secrets management, and resilient error handling.

## Project Setup

Same as `mcp-tool-builder` (TypeScript, esbuild, Jest), plus:

```json
{
  "dependencies": {
    "node-fetch": "^3.3.0"
  }
}
```

Or use Node 20's built-in `fetch` (no dependency needed).

## Lambda Handler Pattern

```typescript
import { handler as baseHandler } from './handler';

interface ToolEvent {
  arguments: Record<string, unknown>;
}

export const handler = async (event: ToolEvent) => {
  const args = event.arguments;

  // API key from environment (set during deployment)
  const apiKey = process.env.API_KEY;

  try {
    const response = await fetch(`https://api.example.com/endpoint?q=${encodeURIComponent(args.query as string)}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(10000), // 10s timeout
    });

    if (!response.ok) {
      throw new Error(`API returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return {
      // Transform API response to tool output
      result: data.field,
      source: 'api.example.com',
    };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { error: 'External API timed out', source: 'api.example.com' };
    }
    return { error: `API error: ${String(err)}`, source: 'api.example.com' };
  }
};
```

## API Key Management

Tools that need API keys should:

1. **Accept keys as environment variables** — The tool Lambda gets env vars set during deployment
2. **Document required keys in output.json** — Add an `environment` field:

```json
{
  "tools": [{
    "toolName": "weather-lookup",
    "environment": {
      "WEATHER_API_KEY": "required - OpenWeatherMap API key"
    }
  }]
}
```

3. **For public/free APIs** — No key needed, just use fetch directly
4. **Never hardcode API keys** in source code

## Resilient HTTP Patterns

### Retry with backoff
```typescript
async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 3): Promise<Response> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(10000),
      });
      if (response.ok || response.status < 500) return response;
      // Server error — retry
    } catch (err) {
      if (attempt === maxRetries) throw err;
    }
    await new Promise(r => setTimeout(r, attempt * 1000));
  }
  throw new Error('Max retries exceeded');
}
```

### Response validation
Always validate API responses before returning. External APIs can change format without notice:
```typescript
const data = await response.json();
if (!data || typeof data !== 'object') {
  return { error: 'Unexpected API response format' };
}
```

## Testing API Integrations

Mock external calls in tests — don't depend on live APIs:

```typescript
// tests/index.test.ts
import { handler } from '../src/index';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe('weather-lookup', () => {
  beforeEach(() => mockFetch.mockClear());

  it('returns weather data on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ main: { temp: 72 }, weather: [{ description: 'clear sky' }] }),
    });

    const result = await handler({ arguments: { city: 'San Francisco' } });
    expect(result.temperature).toBe(72);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('handles API errors gracefully', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429, statusText: 'Too Many Requests' });

    const result = await handler({ arguments: { city: 'test' } });
    expect(result.error).toContain('429');
  });
});
```

## Test Cases for output.json

Since deployed smoke tests will hit the real API, design test cases that work with public/free endpoints, or use inputs that produce predictable results:

```json
{
  "testCases": [
    {
      "input": { "city": "London" },
      "expectedOutput": { "city": "London" },
      "description": "Returns data for a major city"
    }
  ]
}
```

Use partial matching — don't assert exact API response values that change (like current temperature).
