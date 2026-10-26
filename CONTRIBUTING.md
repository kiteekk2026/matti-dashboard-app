# Contributing

This guide covers how to set up the project, make a change and get it merged. Keep it short, keep it current: if a rule here no longer matches how we work, fix the rule in the same PR.

## 1. Local setup

Requirements: Node.js 22 and pnpm 10.

```bash
git clone <repo-url>
cd <repo>
pnpm install
cp .env.example .env.local   # fill in the values below
pnpm dev
```

| Variable | Purpose | Where to get it |
|---|---|---|
| `POSTGRES_URL` | Database connection | Your own Neon dev branch — never production |
| `NEXT_PUBLIC_SUPABASE_URL` | Auth | Supabase project settings |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Auth | Supabase project settings |
| `AUTH_SECRET` | Session signing | `openssl rand -base64 32` |

`.env*` files are git-ignored. Never commit secrets — if one leaks, rotate it immediately and tell the maintainer.

## 2. Workflow

1. Every change starts from an issue with clear acceptance criteria.
2. Branch from `main`: `feature/<issue>-short-name`, `fix/<issue>-short-name`, `docs/<issue>-short-name`.
3. Commit with [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `test:`, `docs:`, `ci:`, `chore:`, `refactor:`.
4. Open a pull request against `main`, link the issue (`Closes #12`) and request a review.
5. Address review comments, wait for green CI and approval, then squash-merge.

Never push directly to `main`, and never merge your own PR without approval.

## 3. Pull request rules

- **One logical change per PR.** Dependency updates, features, CI changes and docs go in separate PRs.
- **Aim for under ~400 changed lines** (lockfiles excluded). Bigger work is split into stacked PRs.
- **The title describes the whole change**, not the last commit.
- **Rebase on `main` before requesting review** and resolve conflicts yourself.
- The description says what changed, why, and how the reviewer can test it.

## 4. Before you open a PR

Run the same checks CI runs:

```bash
pnpm lint
pnpm exec tsc --noEmit
pnpm test
pnpm build
```

A PR with failing checks is not ready for review.

## 5. Tests

- New logic and every bug fix come with a test that **executes the code** — not a test that searches the source text.
- Tests live in `tests/` and are named `*.test.mjs` so the test runner picks them up.
- Tests never touch the production or shared Preview database.

## 6. Database changes

- Schema changes are made only through a migration file in `migrations/`, named `YYYYMMDD_description.sql`.
- Every migration is tested on your own Neon branch before review.
- Destructive changes (dropping columns or tables) need a rollback note in the PR.
- Seeding happens through a local script, never through an HTTP endpoint.

## 7. Security

- Every Server Action and API route that reads private data or changes data checks **authorization**, not just that someone is logged in: who is this user, and are they allowed to touch this record?
- Validate all input on the server (we use Zod).
- Error responses never return raw database errors or stack traces.
- Found a vulnerability? Report it privately to the maintainer, not in a public issue.

## 8. Using AI tools

AI coding assistants are welcome. The rules are the same as for code you write by hand:

- **You own what you submit.** You must be able to explain every line in your PR during review.
- Read and run generated code before committing it. Do not commit code you have not executed.
- Generated tests must test real behaviour, not just make CI green.
- Mention in the PR description if a substantial part was AI-generated, and which tool you used.
- Never paste secrets, credentials or customer data into an AI tool.

## 9. Code style

- ESLint and TypeScript settings are the source of truth; don't argue style in reviews, change the config instead.
- Files are UTF-8 without BOM, with LF line endings (enforced by `.editorconfig`).
- Prefer clear names over comments; comment the *why*, not the *what*.
- Remove debugging code and commented-out blocks before review.

## 10. Definition of Done

A task is done when:

- [ ] Acceptance criteria are met
- [ ] Tests cover the change and CI is green
- [ ] Documentation is updated if behaviour or setup changed
- [ ] The PR is approved and merged
- [ ] The change is verified in the Preview deployment
- [ ] The issue is closed and actual hours are recorded