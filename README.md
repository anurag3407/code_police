<div align="center">

# 🚓 Code-Police

**Self-healing code & an AI co-maintainer for open source.**

Automated PR review, a real dependency **blast-radius graph**, merge-conflict
pre-checks, and self-healing fixes — so maintainers spend less time on DevOps
and more time shipping.

`$ code-police --watch your-repo` ▋

</div>

---

## Why

Open-source maintainers drown in review work. A PR lands and you have to figure
out, by hand: *What does this actually touch? What breaks downstream? Will it
even merge cleanly?* Code-Police answers all three automatically, in plain
language, on every pull request.

## Features

- 🕸️ **Dependency blast-radius graph** — builds a *real* import graph of your
  repo and shows exactly which files a PR changes and which files are
  transitively affected, with a risk score and a rendered graph.
- 🔀 **Merge-conflict pre-check** — flags likely conflicts *before* you merge by
  comparing PR and base-branch edits at the line-range level.
- 🤖 **AI PR review** — security, performance, bug and readability findings
  posted straight to the PR (powered by Gemini).
- 🩹 **Self-healing** — optionally generates fix PRs automatically.
- 🔑 **Bring Your Own Key (BYOK)** — every user can supply their own Gemini key
  (AES-encrypted at rest), so the project is sustainable to self-host and run
  for the community.
- 🖥️ **Terminal-native UI** — a dark, hacker-aesthetic dashboard.

## How it works

```
push / pull_request webhook
        │
        ▼
  GitHub webhook handler ──► AI analysis (Gemini, BYOK-aware)
        │                         │
        ▼                         ▼
  dependency graph          PR review comment
   + conflict check    ──►  + impact graph posted to the PR
```

Core engine lives in `src/lib/agents/code-police`:

| Module | Responsibility |
| --- | --- |
| `dependency-graph.ts` | Build the import graph & compute PR blast radius |
| `conflict-detector.ts` | Line-range merge-conflict pre-detection |
| `pr-impact.ts` | Orchestrates graph + conflicts into one report |
| `byok.ts` | Encrypt / resolve user-supplied API keys |
| `analyzer.ts` | Gemini-powered code review chains |

## Quick start

```bash
git clone https://gitlab.com/sayalabs-group/code-police.git
cd code-police
npm install
cp .env.example .env.local   # then fill in the values
npm run dev
```

Open http://localhost:3000

### Required services

- **Clerk** for auth (GitHub OAuth)
- **Firebase / Firestore** for storage
- **Gemini API key** (platform default) — or let users BYOK
- **Resend** for email reports (optional)

See `.env.example` for the full list.

### Enabling BYOK

Set `BYOK_ENCRYPTION_KEY` to a long random secret
(`openssl rand -base64 32`). Users can then add their own Gemini key per
project via project settings; the platform key is used as a fallback.

## On-demand PR impact

```http
POST /api/code-police/projects/{id}/impact
{ "prNumber": 42 }
```

Returns the dependency blast-radius, conflict report, and a Markdown comment.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build (validates env first) |
| `npm run lint` | ESLint |
| `npm run type-check` | TypeScript, no emit |

## Contributing

Contributions are very welcome — this project is built *for* maintainers, *by*
the community. Read [CONTRIBUTING.md](CONTRIBUTING.md) to get started.

## License

[MIT](LICENSE) © Code-Police contributors.


## Supported Languages
| Language | Support Level |
| --- | --- |
| TypeScript/JavaScript | Full |
| Python | Experimental |
| Go | Planned |
