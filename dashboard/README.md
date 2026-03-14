# 🤖 Pixel Art Agent Dashboard

A standalone, zero-dependency web app that visualises 12 AI agents working in a virtual office. Each desk reflects the agent's current GitHub Issues status with CSS animations.

## Quick Start

```bash
# from the repo root
cd dashboard
python -m http.server 8080
# open http://localhost:8080
```

Or just open `index.html` directly in any browser — it's self-contained.

## Configuration

### URL parameters (no code changes required)

| Param    | Description                        | Example                     |
|----------|------------------------------------|-----------------------------|
| `repo`   | GitHub repo (`owner/repo`)         | `?repo=my-org/my-repo`      |
| `token`  | GitHub Personal Access Token       | `?token=ghp_xxxxxxxxxxxx`   |
| `poll`   | Poll interval in **seconds**       | `?poll=60`                  |

Example:
```
http://localhost:8080/?repo=Art-of-Technology/openclaw-team-provisioner&token=ghp_xxx&poll=60
```

### Edit CONFIG directly

Open `index.html` and find the `CONFIG` block near the top of the `<script>` tag:

```javascript
const CONFIG = {
  repo:         'Art-of-Technology/openclaw-team-provisioner',
  githubToken:  '',       // add your PAT here for higher rate limits
  pollInterval: 30_000,   // milliseconds
  agents: [ … ]
};
```

## Agent → Issue Label Mapping

Each agent card matches GitHub issues by **label**:

| Agent          | Matched Labels                              |
|----------------|---------------------------------------------|
| Product Owner  | `epic`, `user-story`, `po`                  |
| Project Manager| `task`, `pm`                                |
| Architect      | `needs-architecture`, `architecture`        |
| Senior Dev     | `ready-for-dev`, `in-progress`, `senior-dev`|
| UI Designer    | `ui`, `design`, `frontend`                  |
| DB Engineer    | `db-design`, `database`, `db`               |
| QA Tester      | `needs-test`, `testing`, `qa`               |
| Security       | `security`, `auth`                          |
| API Reviewer   | `api`, `api-review`                         |
| CI/CD          | `ci`, `cd`, `cicd`, `devops`                |
| Code Review    | `needs-review`, `pr-open`, `code-review`    |
| Infra          | `infra`, `infrastructure`, `ops`            |

## State → Animation

| Issue label(s)          | State     | Animation         | Visual   |
|-------------------------|-----------|-------------------|----------|
| `in-progress`, `wip`    | Working   | Bounce (typing)   | 💻 blue  |
| `needs-review`, `pr-open` | Reviewing | Pulse (reading) | 👀 amber |
| any other label         | Waiting   | Sway (thinking)   | ⏳ purple|
| `done`, `merged`        | Done      | Jump (celebrate)  | ✅ green |
| no matching issue       | Idle      | Slow bob          | 💤 grey  |

## GitHub API Rate Limits

- **Unauthenticated:** 60 req/hour
- **Authenticated (PAT):** 5,000 req/hour

With 30-second polling that's 120 requests/hour, so a token is recommended for sustained use.

Add a [Personal Access Token](https://github.com/settings/tokens) with `repo:read` scope.

## Features

- **Dark pixel-art office theme** with `Press Start 2P` font (loaded from Google Fonts; falls back to Courier New)
- **4×3 responsive grid** — collapses to 3-col on tablet, 2-col on mobile
- **Speech bubbles** — show the current issue number + title
- **Activity log** — last 10 state change events with timestamps
- **Rate-limit detection** — banner shown when GitHub returns 403/429
- **Manual refresh button** — bypass the poll timer on demand
- **Self-contained** — single HTML file, no npm, no build step

## File Structure

```
dashboard/
  index.html   # entire app — HTML + CSS + JS
  README.md    # this file
```
