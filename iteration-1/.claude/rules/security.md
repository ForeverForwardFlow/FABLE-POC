# Security Rules

## Secrets and Credentials

- NEVER commit API keys, tokens, or secrets to the repository
- Use environment variables for all credentials
- Credentials go in `.env` (gitignored) or environment
- For Cloudflare Workers: use `wrangler secret put`

## Code Safety

- All MCP tool inputs MUST be validated with Zod schemas
- Sanitize error messages — no emails, tokens, or file paths in output
- Never use `eval()` or `new Function()` with user input

## Git Safety

- Never use `--force` with git push
- Never commit `.env`, `.dev.vars`, or credential files
- Check `git status` before committing to avoid secrets

## Remote MCP Servers

- API keys passed via Bearer token header
- Secrets set via `wrangler secret put`, not in code
- `.dev.vars` for local development (gitignored)
- Environment variables injected at runtime, never hardcoded
