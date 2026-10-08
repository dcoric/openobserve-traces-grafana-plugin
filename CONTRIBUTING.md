# Contributing

Thanks for contributing to the OpenObserve Traces data source for Grafana. This guide covers setup, which checks to run for your change, and how to open a pull request. Full environment details are in [docs/DEV-ENVIRONMENT.md](docs/DEV-ENVIRONMENT.md).

## Before you start

- Comment on the issue you want to work on so others know it is taken.
- Ask setup questions on the issue. Maintainers are glad to help.
- Install the prerequisites:
  - Node 24 (see `.nvmrc`)
  - Go 1.26.5 or newer (see `go.mod`)
  - [Mage](https://magefile.org)
  - Docker Compose with support for the `!override` tag (only needed for the local stack and browser tests)

## Workflow

1. Fork the repository and clone your fork.
2. Create a branch from `main`, for example `docs/contributing-guide` or `fix/issue-123`.
3. Make your change.
4. Run the checks that apply to your change (see below).
5. Open a pull request against `main` and reference the issue, for example `Closes #39`.

## Install and build

```
npm ci
npm run build
mage buildAll
```

## Which checks to run

| Change type | Commands | Needs the Docker stack? |
| --- | --- | --- |
| Documentation only | Check that Markdown renders and relative links resolve on GitHub | No |
| Frontend (TypeScript/React) | `npm run typecheck`, `npm run lint`, `npm run test:ci` | No |
| Seed scripts (`dev/seed`) | `node --test dev/seed/*.test.mjs` | No |
| Backend (Go) | `go test -race ./pkg/...` | No |
| Browser (Playwright) | `npm run e2e` | Yes, a running and successfully seeded stack |

CI runs the same commands on pull requests to `main`. Run the ones that match your change before pushing, so CI does not surprise you.

## Running the local stack

The Compose stack runs Grafana with the plugin, OpenObserve, an OpenTelemetry collector, Loki, and a one-shot seed job.

```
docker compose up --build -d
docker wait "$(docker compose ps -aq seed)"
docker compose logs seed
```

The seed must exit successfully and print `Indexed ... complete traces and verified correlated Loki logs`. A successful collector POST alone does not mean the stack is ready. Then open <http://localhost:3000>, go to **Explore**, and select **OpenObserve Traces**.

For frontend watch mode, run `npm run dev`. To run the full stack in the foreground, run `npm run server`.

## Rebuilding after a change

- Frontend changes: `npm run build` (or keep `npm run dev` running).
- Backend changes: rebuild with `mage build:linuxARM64` on Apple Silicon or `mage build:linux` on x86_64.
- Restart Grafana after you replace the backend binary or change `src/plugin.json`:

  ```
  docker compose restart grafana
  ```

## Where things live

- Frontend: `src/`
- Backend: `pkg/plugin/`, with test fixtures in `pkg/plugin/testdata/`
- Browser tests: configured by `playwright.config.ts`
- Seed generator and its tests: `dev/seed/`
- Dev stack and environment reference: `docker-compose.yml` and [docs/DEV-ENVIRONMENT.md](docs/DEV-ENVIRONMENT.md)
- Manual test steps: [docs/MANUAL-TESTING.md](docs/MANUAL-TESTING.md)

`dist/` is generated and ignored by Git. Do not commit it.

## Generated configuration

The `.config/` directory is managed by Grafana plugin tools. Do not edit files in it. The project rules for contributors and AI agents are in [.config/AGENTS/instructions.md](.config/AGENTS/instructions.md). In short: do not change the plugin ID or type in `plugin.json`, and use the existing webpack and mage setup for builds.

## Scope

Deployment, signing, and release steps are documented in [docs/VALIDATION.md](docs/VALIDATION.md) and the CI workflows. This guide covers contributing only.

## Pull request checklist

- [ ] The PR references the issue it addresses.
- [ ] The checks for your change type pass locally.
- [ ] If you changed the browser tests or the seed, the seeded stack ran and `npm run e2e` passed.
- [ ] Links in any Markdown you changed resolve on GitHub.
- [ ] You have not edited files under `.config/`.
