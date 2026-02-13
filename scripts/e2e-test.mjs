#!/usr/bin/env node
/**
 * E2E test: Chat → Build → Deploy via WebSocket
 *
 * Sends a clear, specific build request that should trigger the build
 * without much back-and-forth, then monitors for build completion.
 */

import WebSocket from 'ws';

const WS_URL = 'wss://f9qynczzkj.execute-api.us-west-2.amazonaws.com/dev';
const TIMEOUT_MS = 15 * 60 * 1000; // 15 min max wait for build

// Simple, unambiguous build request
const BUILD_REQUEST = `Build me a tool called "word-reverser" that takes a string input called "text" and returns the text with each word reversed (but words stay in the same order). For example "hello world" becomes "olleh dlrow". That's all the requirements - please start building now.`;

let conversationId = null;
let buildId = null;
let buildTriggered = false;
let chunks = [];

console.log('=== FABLE E2E Test ===');
console.log(`Connecting to: ${WS_URL}`);
console.log(`Request: ${BUILD_REQUEST.slice(0, 80)}...`);
console.log('');

const ws = new WebSocket(WS_URL);

const timeout = setTimeout(() => {
  console.log('\n--- TIMEOUT: Build did not complete within 15 minutes ---');
  ws.close();
  process.exit(1);
}, TIMEOUT_MS);

ws.on('open', () => {
  console.log('[connected]');
  console.log(`[sending] ${BUILD_REQUEST.slice(0, 60)}...`);
  ws.send(JSON.stringify({
    type: 'message',
    payload: { content: BUILD_REQUEST, conversationId },
  }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());

  switch (msg.type) {
    case 'chat_chunk':
      process.stdout.write(msg.payload?.content || '');
      chunks.push(msg.payload?.content || '');
      break;

    case 'chat_complete': {
      console.log('\n[chat_complete]');
      const convId = msg.payload?.conversationId || msg.conversationId;
      if (convId) {
        conversationId = convId;
        console.log(`[conversationId: ${conversationId}]`);
      }

      // If build was already triggered by build_started event, just wait
      if (buildTriggered) {
        console.log('[Build already triggered, waiting for completion...]');
        chunks = [];
        break;
      }

      // No build triggered yet — chat is asking questions, send follow-up
      console.log('[Chat responded without triggering build - sending follow-up...]');
      setTimeout(() => {
        const followUp = "Yes, that's everything. Please go ahead and build it now.";
        console.log(`[sending] ${followUp}`);
        chunks = [];
        ws.send(JSON.stringify({
          type: 'message',
          payload: { content: followUp, conversationId },
        }));
      }, 1000);
      break;
    }

    case 'build_started':
      buildId = msg.payload?.buildId;
      buildTriggered = true;
      console.log(`\n[BUILD STARTED] buildId: ${buildId}, tool: ${msg.payload?.toolName}`);
      console.log('[Waiting for build_completed or build_failed...]');
      break;

    case 'tool_use':
      console.log(`\n[tool_use] ${msg.payload?.toolName}`);
      break;

    case 'tool_result':
      console.log(`\n[tool_result] success: ${msg.payload?.result?.success}`);
      break;

    case 'build_completed':
      console.log('\n=== BUILD COMPLETED ===');
      console.log(JSON.stringify(msg.payload, null, 2));
      clearTimeout(timeout);
      ws.close();
      process.exit(0);
      break;

    case 'build_failed':
      console.log('\n=== BUILD FAILED ===');
      console.log(JSON.stringify(msg.payload, null, 2));
      clearTimeout(timeout);
      ws.close();
      process.exit(1);
      break;

    default:
      console.log(`\n[${msg.type}]`, JSON.stringify(msg).slice(0, 200));
  }
});

ws.on('error', (err) => {
  console.error('[WebSocket error]', err.message);
  clearTimeout(timeout);
  process.exit(1);
});

ws.on('close', () => {
  console.log('\n[disconnected]');
  clearTimeout(timeout);
});
