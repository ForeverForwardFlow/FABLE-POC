# Iteration 2: CLAUDE.md as Infrastructure

> "Pray to the Omnissiah — Trust the Machine Spirit"

This iteration abandons programmatic orchestration in favor of prompt-first design.

## Philosophy

- Don't write services, write prompts
- Don't teach Claude how to think, remind it of capabilities
- Trust the machine spirit to find the path
- Provide context, tools, and guardrails — not control flow

## Structure

```
iteration-2/
├── templates/                    # Base CLAUDE.md templates
│   ├── CLAUDE.md.core-base      # The Architect (one-shot planning)
│   ├── CLAUDE.md.oi-base        # The Manager (Wiggum loop)
│   └── CLAUDE.md.worker-base    # The Builders (Wiggum loop)
└── README.md
```

## How It Works

1. **FABLE-CORE** receives user request, creates specification + extended templates
2. **FABLE-OI** receives spec, spawns parallel workers, integrates results, verifies
3. **Workers** complete focused tasks, iterate until acceptance criteria pass

Each level extends base templates, ensuring guardrails cascade through all levels.

## See Also

- [Brainstorm Addendum](../brainstorm-addendum-iteration-2.md) — Full design documentation
- [Original Brainstorm](../brainstorm.md) — Product vision
