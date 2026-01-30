---
active: true
iteration: 1
max_iterations: 10
completion_promise: "TASK_COMPLETE"
started_at: "2026-01-29T22:50:27.070Z"
---

Complete the task described in CLAUDE.md. Follow all instructions carefully.

You are in a Ralph Wiggum iteration loop. The loop will continue until you signal completion.

IMPORTANT - Completion Signal:
When the task is FULLY complete (all acceptance criteria met, tests passing), output:
<promise>TASK_COMPLETE</promise>

CRITICAL RULES:
- Only output the promise tag when the task is GENUINELY complete
- Do NOT output false statements to exit the loop
- If tests fail, fix them before signaling completion
- The loop will automatically continue if you don't output the promise

Start by reading CLAUDE.md to understand the task.
