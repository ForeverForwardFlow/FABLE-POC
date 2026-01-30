/**
 * Requirements Gathering Phase
 *
 * Takes a raw user request and produces structured requirements.
 * May involve clarifying questions if the request is ambiguous.
 */

import type { Requirements } from '@fable/shared';

/**
 * Gather and structure requirements from a user request.
 *
 * In the full implementation, this will use Claude Agent SDK
 * to have a conversation if requirements are unclear.
 *
 * @param request - Raw user request
 * @returns Structured requirements
 */
export async function gatherRequirements(request: string): Promise<Requirements> {
  // TODO: Implement with Claude Agent SDK
  // For now, pass through as a simple requirement

  return {
    summary: request,
    details: request,
    constraints: [],
    acceptanceCriteria: ['Implementation matches request', 'All tests pass', 'No lint errors'],
  };
}
