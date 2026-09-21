# Contributing to DiffAtlas

Thanks for your interest in improving DiffAtlas! This is a 100% client-side 
project — no backend, no API keys required to develop locally.

## Getting Started

1. Fork and clone the repo
2. Install dependencies: `npm install`
3. Start the dev server: `npm run dev`
4. Run tests: `npm test`
5. Typecheck: `npx tsc --noEmit`

## Project Structure

- `src/lib/diff-engine/` — core diff algorithms (JSON, CSV, YAML, image), 
  built as a plugin system via `core/registry.ts`
- `src/lib/merge/` — three-way merge logic
- `src/lib/export/` — JSON Patch and PDF export
- `src/components/` — UI components

## Guidelines

- Add tests for any new diff logic (Vitest) — see existing `*.test.ts` files 
  for patterns
- Keep the app fully client-side — no new backend dependencies or API keys
- Run `npx tsc --noEmit` and `npm test` before opening a PR
- Follow the existing plugin interface (`DiffPlugin` in `core/types.ts`) 
  when adding a new file-type diff

## Reporting Issues

Open a GitHub issue with steps to reproduce, expected vs actual behavior, 
and sample input files if relevant (e.g. the JSON/CSV that triggered the bug).
