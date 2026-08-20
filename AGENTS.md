# AGENTS.md — markdown-publish

Build guide for coding agents working in this repo. Everything below was verified by running the commands in this repository.

## 1. Project overview

**markdown-publish** (`@abstractwebunit/markdown-publish`, v1.0.6) turns an Obsidian/Markdown vault (a folder of `.md` notes, `.canvas` boards, `.quiz.json` decks, and assets) into a fully static website with instant search, an interactive link graph, canvas boards, and quiz decks. It ships as an **npm CLI** + **GitHub Action**; consumers deploy the output anywhere (GitHub Pages / Netlify / Vercel / Cloudflare).

The build pipeline has two stages:

1. **Build-time vault parser** (Node, `tools/vault-parser/`) — walks the vault, renders Markdown (wikilinks, embeds, callouts, tags, footnotes) to HTML, and emits a JSON "content bundle" into `src/content/` (notes, canvas models, quiz decks, link graph, search index, manifest, hashed assets).
2. **Angular SSG prerender** — an Angular 22 app (`src/`) consumes that bundle at build time, prerenders every route to static HTML (`outputMode: static`), then Pagefind + small Node scripts add search, SEO files, and a social card.

The repo **dogfoods the product**: the docs site (abstractwebunit.github.io/markdown-publish-docs) is built by this tool, and `tools/fixtures/vault/` is the test vault used to exercise the pipeline.

## 2. Tech stack

| Concern | Choice | Notes |
|---|---|---|
| Languages | TypeScript (strict), plain ESM `.mjs` for standalone Node tools, SCSS, HTML | |
| Frontend | Angular **22** (standalone components, no NgModules), `@angular/ssr`, `@angular/build` | Signals, `resource()` API, new `@if/@for` control flow throughout |
| Canvas boards | `@ng-draw-flow/core` | Custom node types in `src/app/canvas/` |
| Graph | `d3-force` + WebGL (`src/app/graph/`) | |
| Markdown rendering | `markdown-it` + plugins (anchor, footnote, task-lists), `highlight.js` | Custom wikilink/tag/callout rules in `tools/vault-parser/markdown.ts` |
| Runtime | Node `>=20` (repo tested on Node 24.18.0) | `packageManager: npm@11.13.0` |
| Package manager | npm | `npm install`, lockfile `package-lock.json` |
| Search | `pagefind` (client-side, no server) | Also a custom keyword index for WebMCP + search service |
| Sanitization | `dompurify` (runtime), MarkdownIt `html: false` (build) | |
| OG image | `@resvg/resvg-js` | Fallback copies `public/og-default.png` |
| Dev container | `.devcontainer/devcontainer.json` | Node 24 image (trixie) |
| Storage | None (fully static) | No DB, no backend at runtime |

**Key config files:** `package.json` (scripts, `bin`, `files`), `angular.json` (build/serve/test targets), `tsconfig.json`/`tsconfig.app.json`/`tsconfig.spec.json` (root/refs), `tools/tsconfig.json` (tools + shared), `.prettierrc` (formatting), `action.yml` (GitHub Action), `templates/` (consumer deploy configs).

## 3. Repository structure

```
tools/cli/            CLI: cli.mjs (entry), resolve-config.mjs, run-build.mjs (+ node:test specs)
tools/vault-parser/   Build-time vault→JSON pipeline: parse-vault.ts, markdown.ts, canvas.ts, quiz.ts, slug.ts, run.ts
tools/gen-seo.mjs     Post-build: robots.txt, sitemap.xml, llms.txt, 404.html
tools/gen-og.mjs      Post-build: og.png social card (1200x630)
tools/static-serve.mjs  Local static file server (SPA fallback), default port 4301
tools/fixtures/vault/ Test vault (Home.md, Secret.md, Notes/, Board.canvas, Quiz/Spanish.quiz.json, diagram.png)

shared/content-model/ Shared TS types consumed by BOTH parser and Angular app (path alias @shared/*):
                      manifest.ts, note.ts, canvas.ts, quiz.ts, graph.ts, search.ts, obsidian.ts

src/                  Angular SSG app (the site frontend)
  main.ts             Browser bootstrap
  main.server.ts      Server bootstrap (prerender)
  server.ts           Express SSR server (used by ng dev-server; NOT emitted to dist)
  index.html          App shell HTML (note: <base href="/"> is rewritten at build)
  app/                app.config.ts, app.routes.ts, app.spec.ts, shell/, views/, content/, search/,
                      graph/, canvas/, nav/, aside/, seo/, theme/, webmcp/
  styles.scss         Global styles
  content/            GENERATED — vault-parser output: notes/, canvas/, quiz/, assets/, graph.json,
                      search-index.json, manifest.json (gitignored; also excludes from npm publish)

public/               Static assets copied verbatim: favicon.svg, og-default.png

templates/            Consumer deploy configs: publish.yml (GitHub Pages), netlify.toml, vercel.json
action.yml            Composite GitHub Action definition for consumers
.agents/              pi agent skills + prompts (code-review, implement, grill-me, …)
.vscode/              tasks (ng serve / ng test), launch configs, MCP server config
```

**Generated, never edit by hand:** `src/content/` (parser output), `dist/` (build output), `.angular/` (cache), `out-tsc/`. All gitignored. `src/content` is regenerated on every build — changes there are lost.

## 4. Entry points & architecture

**CLI entry:** `tools/cli/cli.mjs` (npm `bin`: `markdown-publish`). Only subcommand: `build`. Flow: `parseFlags` → `resolveConfig` → `runBuild`. Config precedence: **defaults < `markdown-publish.config.json` < env (`MP_*` only) < flags**.

**Build pipeline** (`runBuild` in `tools/cli/run-build.mjs`) — orchestrated by spawning Node on the package's own bins (no shell):
1. `tsx tools/vault-parser/run.ts` — vault → `src/content/` (env contract: `VAULT`, `BASE_HREF`, `CONTENT_OUT`, `BUILD_MODE`, `SITE_NAME`, `SITE_URL`, `SITE_LANG`, `SITE_DESCRIPTION`, `SITE_FOOTER`, `HOME_NOTE`). It deletes `src/content` and `dist` first.
2. `ng build --base-href <href>` — Angular SSG prerenders all routes (reads `src/content` from disk via `ServerContentService`) → `dist/markdown-publish/browser` + `prerendered-routes.json`.
3. `pagefind --site dist/markdown-publish/browser` — search index.
4. `tools/gen-seo.mjs` — robots.txt, sitemap.xml, llms.txt, 404.html (reads `prerendered-routes.json` + `SITE_URL`).
5. `tools/gen-og.mjs` — og.png from `SITE_NAME`/`SITE_DESCRIPTION`.
6. Copies browser output to `--out` dir.

**Angular app** (runtime data flow):
- `src/main.ts` bootstraps `App` → `AppShell` (sidebar nav, theme toggle, search overlay) + router outlet.
- Routes (`app.routes.ts`): `''` → redirect to home note (`manifest.site.homeSlug`); `graph` → `GraphView`; `**` → `RouteDispatch`, which looks the slug up in the manifest and renders `NoteView` / `CanvasView` / `QuizView` / `NotFound`.
- `ContentService` (browser: `fetch` of `/content/...` resolved against `<base href>`) vs `ServerContentService` (prerender: `fs` read of `src/content`) — swapped by DI in `app.config.server.ts`. **This is the key browser/server boundary.**
- `SeoService` writes title/meta/OG/JSON-LD into the (domino) document so it lands in prerendered HTML.
- `WebmcpService` registers agent tools (`search_notes`, `get_note`, `list_notes`, `get_backlinks`) on `navigator.modelContext` via a zero-dependency polyfill.
- Graph: `GraphCanvas` runs a `d3-force` simulation rendered to WebGL; `LocalGraph` beside each note.
- Canvas: `CanvasView` maps the JSON canvas model (`toDrawFlowModel`) into `@ng-draw-flow` with custom nodes (`markdown-node`, `file-node`, `image-node`, `link-card`, `group-node`).

**Runtime is fully static** — `src/server.ts` exists only for the dev server / prerender engine. Nothing is emitted under `dist/.../server` because `outputMode: "static"` (see Gotchas).

## 5. Development workflow

Prereqs: Node ≥ 20, npm ≥ 11 (repo pins `npm@11.13.0`; `corepack` or a matching npm is safest). `npm ci` / `npm install` at repo root.

```bash
npm install            # install deps (node_modules already present in this workspace)

npm run parse          # parse tools/fixtures/vault → src/content  (also: npm run build:content)
npm run build          # ng build (production SSG; full typecheck included)
npm run build:site     # full pipeline: content → app → pagefind → seo → og (fixtures vault)
npm run serve:static   # serve dist/markdown-publish/browser on :4301 (SPA fallback)
npm start              # ng serve dev server (default :4200, HMR); needs src/content present first
npm run watch          # ng build --watch --configuration development
```

**Local dev loop:** `npm run parse` (or build the content from your own vault via the CLI), then `npm start`. `ng serve` uses `src/content` as an asset input (`angular.json`), so re-run `npm run parse` after vault changes to refresh content. The dev server does NOT run the vault parser for you.

**Environment variables:** the CLI only reads `MP_`-prefixed vars for user config (`MP_SITE_NAME`, `MP_SITE_URL`, `MP_SITE_LANG`, `MP_SITE_DESCRIPTION`, `MP_SITE_FOOTER`, `MP_BUILD_MODE`, `MP_BASE_HREF`, `MP_HOME`) — bare names are deliberately ignored because Netlify sets `SITE_NAME` itself. `siteUrl` auto-detects from `NETLIFY`/`URL`, `CF_PAGES`/`CF_PAGES_URL`, `VERCEL`/`VERCEL_PROJECT_PRODUCTION_URL` when unset. All config also works via flags (`--site-name`, `--vault`, `--out`, `--base-href`, `--build-mode full|public`, …) or `markdown-publish.config.json`.

**CLI usage against a real vault** (what consumers run):
```bash
node tools/cli/cli.mjs build --vault tools/fixtures/vault --out /tmp/site --site-name "Test" --base-href /sub/
# or via the published bin: npx @abstractwebunit/markdown-publish build --vault ./vault --out dist
```

## 6. Testing

Two separate test suites, **two different runners**:

| Suite | Runner | Command | Files | Status |
|---|---|---|---|---|
| CLI / build pipeline | Node built-in `node:test` | `npm run test:cli` | `tools/cli/*.test.mjs` |  |
| Angular app | Vitest via `@angular/build:unit-test` builder | `npm test` | `src/**/*.spec.ts` |  |

- `npm run test:cli` — runs `node --test "tools/cli/**/*.test.mjs"`. Includes `build.test.mjs`, a full end-to-end build of `tools/fixtures/vault` into a temp dir (asserts sitemap, robots, llms, pagefind, og.png dimensions, base-href behavior, wikilink hrefs), and `quiz-public-mode.test.mjs`, a fast parser-level test (spawns only `tsx run.ts`, no `ng build`) proving private notes never reach quiz decks in `public` builds.
- `npm test` — Vitest, config from the Angular builder (no `vitest.config.*` file exists; `tsconfig.spec.json` adds `vitest/globals` types). Single file: `ng test --include src/app/app.spec.ts` (or pass the file path to `--include`).

## 7. Code quality

- **Formatting:** Prettier config exists (`.prettierrc`: `printWidth: 100`, `singleQuote`, `angular` parser for HTML). It is **not enforced** — there is no `format`/`check` script, and `npx prettier --check` currently reports issues in ~38 files. Match surrounding style; don't reformat the whole tree.
- **Type checking:** `ng build` type-checks `src/` + `shared/` (via `tsconfig.app.json`). Tools are plain `.mjs` (untyped) or checked separately:
  ```bash
  npx tsc -p tools/tsconfig.json --noEmit   # tools + shared (passes; exits 0)
  npx tsc -p tsconfig.json --noEmit          # project refs sanity (passes)
  ```

## 8. Conventions (inferred from the code)

- **Angular:** standalone components only, `ChangeDetectionStrategy.OnPush`, signals + `resource()` + `toSignal`, new `@if/@for/@switch` control flow, inject-function DI (no constructor injection). Kebab-case file names matching class name (`app-shell.ts` → `AppShell`), `selector: 'app-…'`.
- **Shared types:** all cross-boundary types live in `shared/content-model/`, imported via the `@shared/*` path alias (defined in `tsconfig.json`, `tsconfig.app.json`, `tools/tsconfig.json`). The parser and the Angular app must agree on these — change them in one place.
- **Manifest kinds:** `RouteEntry.kind` is `'note' | 'canvas' | 'quiz'` and `NavNode.type` is `'folder' | 'note' | 'canvas' | 'quiz'` — quiz decks are a first-class route kind (manifest routes, nav leaves with a question-mark icon, `QuizView`), but deliberately get no link-graph nodes, WebMCP tools, or search-index entries.
- **Env contract:** `run-build.mjs` exports a documented set of env vars to subprocesses; tools read `process.env` (see `run.ts`, `gen-seo.mjs`, `gen-og.mjs`). Keep this contract in sync when adding build options.
- **URLs are base-relative** (no leading `/`) so sites work under a GitHub Pages subpath (`user.github.io/repo/`): wikilink hrefs, asset URLs, and `ContentService` fetches all resolve against `<base href>`. Root-absolute URLs 404 on subpath deployments — a recurring bug class (see commit history).
- **Slugs:** Unicode-aware kebab (Cyrillic/CJK survive; emoji/punctuation dropped), vault-relative path without extension. See `tools/vault-parser/slug.ts`.
- **Error handling:** CLI catches build errors and exits non-zero with `✗ message`; success prints `✓`. Parser rejects with thrown errors. `gen-og.mjs` never fails the build (falls back to the default image).
- **Comment style:** dense "why" comments with concrete rationale and references (e.g. §5/§14, R8.2) — preserve this when editing.
- **Mode filter:** `build-mode: public` only publishes notes with `publish: public` frontmatter (used to hide `Secret.md`-style notes); the parser must keep private notes out of nav, graph, search, and canvases.
- **Agent workflow:** `.agents/skills/implement` says to typecheck regularly, run single tests, run the full suite at the end, then `/code-review`, then commit to the current branch.

## 10. Gotchas

- **`serve:ssr:markdown-publish` is broken** (`node dist/markdown-publish/server/server.mjs`): with `outputMode: "static"` no server bundle is emitted — `dist/markdown-publish/server/` does not exist after a build. Leftover from the Angular template. Use `npm run serve:static` (or `ng serve`) instead.
- **`src/content` is disposable.** `run-build.mjs` (the CLI path) wipes it before parsing; the npm-script path (`build:content`) only overwrites file-by-file, so deleted notes can leave stale JSON behind. Never hand-edit it; add a content-bundle change to the parser, not to `src/content`.
- **Build budget warning is expected:** `initial` bundle ~576 kB exceeds the 500 kB warning budget — a warning, not an error; `npm run build` still exits 0. Don't treat it as a failure.
- **Commands must run from the repo root** — `run-build.mjs` computes `PKG_ROOT` from its own path, but `gen-seo.mjs`/`gen-og.mjs` resolve `dist/...` relative to `process.cwd()`, and `pagefind`/`ng` are spawned with `cwd: PKG_ROOT`. Running npm scripts elsewhere breaks paths.
- **Base-href is load-bearing.** `/repo/` subpath deployments fail (404s, broken sitemap doubling) if URLs regain leading slashes. `build.test.mjs` asserts this — keep those assertions.
- **Env var footguns:** bare `SITE_NAME`/`SITE_URL` are deliberately ignored (Netlify stomps them) — only `MP_*` vars configure the site; provider detection uses provider-scoped vars. Don't "simplify" this.
- **npm publish surface:** `files` whitelist ships `tools`, `src` (minus `src/content`), `shared`, `public`, `angular.json`, `tsconfig*.json`, `action.yml`, `templates` — and excludes `tools/fixtures`. New tool files must land in `tools/` to be published; fixture changes won't ship (fine — tests run pre-publish).
