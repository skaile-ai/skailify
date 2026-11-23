<!-- SPDX-License-Identifier: Apache-2.0 -->

# Releasing to npm

Every JavaScript adapter that is not `"private": true` (`frontend/<name>/`, and any JavaScript or
TypeScript adapter in `backend/<name>/`) is published to npm as `@skaile/skailify-<name>`. Releases
use [Changesets](https://github.com/changesets/changesets) and
[npm trusted publishing](https://docs.npmjs.com/trusted-publishers/): GitHub Actions publishes with a
short-lived OIDC credential and attaches provenance, and nobody holds an npm token.

| Package | Folder |
|---|---|
| [`@skaile/skailify-angular`](https://www.npmjs.com/package/@skaile/skailify-angular) | `frontend/angular/` |
| [`@skaile/skailify-core`](https://www.npmjs.com/package/@skaile/skailify-core) | `frontend/core/` |
| [`@skaile/skailify-react`](https://www.npmjs.com/package/@skaile/skailify-react) | `frontend/react/` |
| [`@skaile/skailify-vue-tsm`](https://www.npmjs.com/package/@skaile/skailify-vue-tsm) | `frontend/vue-tsm/` |

Java adapters (such as `backend/emf-mcp/`) are not published to npm.

## Making a change that ships

1. Change the adapter.
2. Run `bun run changeset` at the repository root, pick the packages it changes and the bump (patch,
   minor or major; while a package is 0.x, a breaking change is a minor bump), and write one or two
   sentences for the changelog.
3. Commit the `.changeset/*.md` file it writes with the change.

The `Changeset` check fails a pull request that changes a published package's `src/`, `package.json`
or `tsdown.config.ts` without a changeset. For a change that needs no release, add an empty one:
`bun run changeset --empty`.

## How a release happens

[`.github/workflows/release.yml`](../.github/workflows/release.yml) runs on every push to `main`:

1. With changesets on `main`, it opens or updates a pull request, "chore(repo): version packages",
   that bumps the versions, writes each package's `CHANGELOG.md` and deletes the changesets.
2. Merging that pull request is the release. The workflow builds every adapter, then publishes each
   package whose version is not on npm yet, tags it (`@skaile/skailify-react@0.2.0`) and creates a
   GitHub Release.

Empty changesets on their own release nothing: while every changeset on `main` is empty, the
workflow neither opens the pull request nor publishes. They wait for the next real changeset, and
they also block step 2, so a failed publish can be retried only once no changesets are left on
`main`.

A pull request opened by the workflow does not trigger CI itself. The changes it carries already
passed CI when they landed. The DCO check skips it: its commit is the bot's, and it only applies the
changesets that were signed off when they landed.

## What a published package looks like

Each package builds with [tsdown](https://tsdown.dev) to ESM and type declarations in `dist/`
(`bun run build`); `@skaile/skailify-core` also builds `dist/skailify.iife.js`, a single file for a
`<script>` tag with its dependencies bundled in. `prepack` builds as well, so `npm pack` and `npm publish` never ship a stale
`dist/`. The tarball holds `dist/`, `README.md`, `AGENTS.md` and `LICENSE`; the sources stay in the
repository, and the source maps carry them inline for debugging. Peer dependencies (the framework,
`@skaile/workspaces`, `zod`) stay external, so the app keeps a single copy of each.

`bun run check:package` in an adapter folder builds it and runs [publint](https://publint.dev) on what
it would publish. CI runs the same check for every published adapter.

## Adding a package

To publish a new adapter:

1. In its `package.json`, remove `"private": true` and add what the published adapters have:
   `repository` (with `directory`), `exports`, `main` and `types` pointing at `dist/`,
   `files: ["dist", "README.md", "AGENTS.md", "LICENSE"]`, `publishConfig.access: "public"`, and the
   `build`, `prepack` and `check:package` scripts. Copy them from
   [`frontend/react/package.json`](../frontend/react/package.json). `repository.url` must be exactly
   `git+https://github.com/skaile-ai/skailify-adapters.git`, or npm rejects the provenance.
2. Copy `tsdown.config.ts` from `frontend/react/`, add `tsdown` and `publint` as dev dependencies, and
   copy the root `LICENSE` into the folder. A backend adapter that runs on Node sets
   `platform: "node"` in its `tsdown.config.ts`.
3. Run `bun run check:package` in the folder, and check what `npm pack --dry-run` lists.
4. Do not add a changeset for the first release, not even an empty one. The first published version
   is the one in `package.json` (`0.1.0`); the `Changeset` check knows a version that is not on npm
   yet needs none. When the pull request is merged with no changesets pending on `main`, the
   workflow publishes it straight away; with changesets pending, it goes out with the next version
   pull request.
5. Before that merge, a maintainer with publish rights on the `@skaile` npm
   scope bootstraps the package once (below). npm accepts trusted publishing only for a package
   that already exists, so the very first version cannot come from the workflow.

## Bootstrapping a new package on npm (once per package)

This needs an npm account with publish rights on `@skaile` and two-factor authentication.

1. Publish a placeholder, so the name exists. From the adapter folder:

   ```sh
   npm login
   npm_config_otp=<6-digit code> bash ../../.github/scripts/publish-placeholder.sh
   ```

   npm asks for a two-factor code on every publish; `npm_config_otp` passes it in. Codes last about
   30 seconds, so take a fresh one for each package.

   It publishes version `0.0.0` of the package with only a package.json and a README, under the
   `bootstrap` dist-tag (`--dry-run` shows it without publishing). npm points `latest` at a new
   package's first version whatever the tag, so `latest` is the empty placeholder until the first
   real release replaces it: keep that gap short.
2. On npmjs.com, open the package, then **Settings → Trusted Publisher**, choose **GitHub Actions**
   and enter:
   - Organization or user: `skaile-ai`
   - Repository: `skailify-adapters`
   - Workflow filename: `release.yml`
   - Environment: leave empty
   - Allowed actions: tick **`npm publish`** as well (Changesets publishes with `npm publish`, and a
     configuration created after 3 September 2026 allows only `npm stage publish` by default).

   npm does not check these values when you save them, so check them by eye.
3. Merge the pull request that publishes (step 4 above) **within two days**. A trusted publisher configuration that has
   not published within two days expires and must be deleted and created again.
4. Once the real version is out, deprecate the placeholder:
   `npm deprecate @skaile/skailify-<name>@0.0.0 "placeholder, use the latest version"`.
5. Recommended: under **Settings → Publishing access**, choose "Require two-factor authentication and
   disallow tokens", so the workflow is the only way to publish.

## When a release fails

- `ENEEDAUTH`, `E404` or "OIDC token exchange failed" on publish: the package has no trusted
  publisher, or its fields do not match (repository, `release.yml`, direct publish allowed). Fix it
  on npmjs.com, then run the workflow again with **Run workflow** (a re-run replays the old commit).
- "provenance ... repository" errors: `repository.url` in `package.json` does not match this
  repository.
- Some packages published, others did not: run the workflow again. It publishes only versions that
  are not on npm yet.
