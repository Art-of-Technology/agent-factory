# Example openclaw.json (relevant sections)

```json
{
  "agents": {
    "defaults": {
      "subagents": {
        "maxConcurrent": 8,
        "maxSpawnDepth": 2,
        "maxChildrenPerAgent": 8,
        "runTimeoutSeconds": 900,
        "model": "anthropic/claude-opus-4-6"
      }
    },
    "list": [
      { "id": "main", "default": true, "name": "Main Assistant", "workspace": "~/.openclaw/workspace",
        "subagents": { "allowAgents": ["po","pm","architect","senior-dev","ui","db","qa","security","api","cicd","code-review","infra"] }
      },
      { "id": "po", "name": "Product Owner", "workspace": "~/.openclaw/workspace-po" },
      { "id": "pm", "name": "Project Manager", "workspace": "~/.openclaw/workspace-pm",
        "subagents": { "allowAgents": ["po","architect","senior-dev","ui","db","qa","security","api","cicd","code-review","infra"] }
      },
      { "id": "architect", "name": "Software Architect", "workspace": "~/.openclaw/workspace-architect" },
      { "id": "senior-dev", "name": "Senior Developer", "workspace": "~/.openclaw/workspace-senior-dev" },
      { "id": "ui", "name": "UI/Frontend Agent", "workspace": "~/.openclaw/workspace-ui" },
      { "id": "db", "name": "Database Agent", "workspace": "~/.openclaw/workspace-db" },
      { "id": "qa", "name": "QA/Testing Agent", "workspace": "~/.openclaw/workspace-qa" },
      { "id": "security", "name": "Security Agent", "workspace": "~/.openclaw/workspace-security" },
      { "id": "api", "name": "API Best Practices Agent", "workspace": "~/.openclaw/workspace-api" },
      { "id": "cicd", "name": "CI/CD Agent", "workspace": "~/.openclaw/workspace-cicd" },
      { "id": "code-review", "name": "Code Review Agent", "workspace": "~/.openclaw/workspace-code-review" },
      { "id": "infra", "name": "Infrastructure Agent", "workspace": "~/.openclaw/workspace-infra" }
    ]
  }
}
```
