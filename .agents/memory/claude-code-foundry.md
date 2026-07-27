---
name: Claude Code Azure Foundry Setup
description: How Claude Code CLI is configured to use Azure AI Foundry with claude-opus-4-8
---

# Claude Code Azure Foundry Setup

## Working Configuration
- CLAUDE_CODE_USE_FOUNDRY=1
- ANTHROPIC_FOUNDRY_RESOURCE=bybitrs9-3794-resource (just name, NOT full URL)
- ANTHROPIC_FOUNDRY_API_KEY=set as shared env var
- ANTHROPIC_DEFAULT_SONNET_MODEL=claude-opus-4-8
- ANTHROPIC_DEFAULT_OPUS_MODEL=claude-opus-4-8
- ANTHROPIC_DEFAULT_HAIKU_MODEL=claude-opus-4-8

**Why:** All three model slots set to opus-4-8 per user request.

**How to apply:** Set as shared env vars in Replit. Claude Code CLI installed via npm at /home/runner/workspace/.config/npm/node_global/bin/claude (already in PATH automatically).

## Key Lessons
- ANTHROPIC_FOUNDRY_RESOURCE must be just the resource name, NOT full URL
- ANTHROPIC_FOUNDRY_BASE_URL and ANTHROPIC_FOUNDRY_RESOURCE are mutually exclusive
- Replit shared env vars override secrets when same key name is used
- Claude Code npm install: @anthropic-ai/claude-code (native curl installer timed out on Replit)
- Two different Azure resources existed — bybitrs9-2607 (old, no models) and bybitrs9-3794 (working)
