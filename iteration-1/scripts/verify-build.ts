#!/usr/bin/env npx tsx
/**
 * Verify Build Script
 *
 * Run all verification steps: build, test, lint.
 * Used by workers to verify their work before signaling completion.
 */

import { execSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    cwd: { type: 'string', default: process.cwd() },
    verbose: { type: 'boolean', short: 'v', default: false },
  },
});

interface VerifyResult {
  step: string;
  success: boolean;
  duration: number;
  error?: string;
}

function runStep(name: string, command: string, cwd: string, verbose: boolean): VerifyResult {
  const start = Date.now();

  try {
    execSync(command, {
      cwd,
      stdio: verbose ? 'inherit' : 'pipe',
      encoding: 'utf-8',
    });

    return {
      step: name,
      success: true,
      duration: Date.now() - start,
    };
  } catch (error) {
    return {
      step: name,
      success: false,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  const cwd = values.cwd!;
  const verbose = values.verbose!;

  console.log(`[verify] Running verification in: ${cwd}`);
  console.log('');

  const steps = [
    { name: 'build', command: 'npm run build' },
    { name: 'test', command: 'npm run test' },
    { name: 'lint', command: 'npm run lint' },
  ];

  const results: VerifyResult[] = [];

  for (const step of steps) {
    process.stdout.write(`[verify] ${step.name}... `);
    const result = runStep(step.name, step.command, cwd, verbose);
    results.push(result);

    if (result.success) {
      console.log(`✓ (${result.duration}ms)`);
    } else {
      console.log(`✗ (${result.duration}ms)`);
      if (!verbose && result.error) {
        console.error(`  Error: ${result.error.slice(0, 200)}`);
      }
    }
  }

  console.log('');

  const failed = results.filter((r) => !r.success);
  if (failed.length > 0) {
    console.log(`[verify] FAILED: ${failed.map((r) => r.step).join(', ')}`);
    process.exit(1);
  }

  console.log('[verify] All checks passed');
  process.exit(0);
}

main().catch((error) => {
  console.error('[verify] Error:', error.message);
  process.exit(1);
});
