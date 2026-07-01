# Contributing to Code-Police

Thanks for helping build an AI co-maintainer for open source! 🚓

## Ground rules

- Be kind. We follow a standard, no-tolerance-for-harassment code of conduct.
- Small, focused PRs are easier to review (and Code-Police will literally show
  the reviewer your PR's blast radius 😉).
- Discuss large changes in an issue first.

## Development setup

```bash
git clone https://gitlab.com/sayalabs-group/code-police.git
cd code-police
npm install
cp .env.example .env.local   # fill in at least Clerk + Firebase + a Gemini key
npm run dev
```

You do **not** need every service to work on the core engine. The dependency
graph and conflict detector
(`src/lib/agents/code-police/dependency-graph.ts`,
`conflict-detector.ts`) are pure functions and are easy to test in isolation.

## Before you open a PR

Run the checks locally — CI runs the same:

```bash
npm run type-check
npm run lint
npm run build
```

## Project layout

```
src/
├─ app/
│  ├─ api/code-police/        # REST endpoints (projects, impact, byok, analyze)
│  └─ dashboard/code-police/  # dashboard UI
├─ components/
│  ├─ code-police/            # feature components (DependencyImpact, ...)
│  └─ ui/                     # primitives (terminal.tsx, ...)
└─ lib/agents/code-police/    # the engine (graph, conflicts, byok, analyzer)
```

## Where to start

- **Good first issues** are labelled in the issue tracker.
- Language support: extend `dependency-graph.ts` (`extractSpecifiers` /
  `resolveSpecifier`) to resolve imports for more ecosystems (Python, Go, Rust).
- UI: the terminal aesthetic lives in `globals.css` (`.term*` classes) and
  `components/ui/terminal.tsx`.

## Commit / PR style

- Use clear, present-tense commit messages.
- Reference the issue number where relevant.
- Add or update docs when you change behavior.

## Security

Never commit secrets. BYOK keys are encrypted with `BYOK_ENCRYPTION_KEY`; if you
touch `byok.ts`, ensure raw keys are never logged or returned to the client.

Happy hacking! `▋`


## Good First Issues
Check the issue tracker for the `good first issue` label. These are typically small bug fixes, documentation improvements, or minor feature enhancements perfectly scoped for new contributors.
