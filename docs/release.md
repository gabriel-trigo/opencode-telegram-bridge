# Release

This project is published as an npm package.

## Mental model
Every CI run (PRs and pushes) requires a changeset for non-doc changes or it
fails. A push to `main` creates or updates the release PR. A merged PR leads to
a push to `main`, so it also updates the release PR. The release PR accumulates
changesets until it is merged. When the release PR is merged, npm publishes a
new version and a GitHub release is created using the accumulated changesets.

## CI + release flowcharts

### Pull request opened
```
PR opened/updated
        |
        v
CI workflow (pull_request)
  |
  +--> npm ci
  +--> changeset check (diff base...head)
  |      |
  |      +--> relevant change + no changeset -> FAIL
  |      +--> docs-only or has changeset     -> OK
  +--> typecheck + tests + build
        |
        v
      Status checks gate merge to main
```

### Push to main
```
Push to main
   |
   v
CI workflow (push)
  |
  +--> npm ci
  +--> changeset check (diff before...after)
  |      |
  |      +--> relevant change + no changeset -> FAIL
  |      +--> docs-only or has changeset     -> OK
  +--> typecheck + tests + build
  |
  v
Release workflow (push)
  |
  +--> changesets/action
         |
         +--> changesets present?
         |      |
         |      +--> yes: create/update release PR (changeset-release/main)
         |      |        (no publish)
         |      |
         |      +--> no: run `npm run release` (publish to npm)
         |
         +--> if published: create GitHub release tag (unless it already exists)
```

## Manual release (local)
1. Add a changeset for your change:

```bash
npx changeset
```

2. Version the release:

```bash
npm run version
```

3. Publish:

```bash
npm run release
```

The `prepublishOnly` script runs the build to ensure `dist/` is included.

## Required setup (GitHub Actions)
- Configure npm Trusted Publishing for this repo and workflow file (`release.yml`).
- The workflow requires `id-token: write` permission to publish via OIDC.
- npm CLI 11.5.1+ is required for trusted publishing.

## CI enforcement
CI fails if a relevant code change lands without a `.changeset/*.md` file.
Docs-only updates (`docs/`, `README.md`, `.github/`) do not require a changeset.

## FAQ

### How is the version bump decided?
You pick it when you run `npx changeset`. The changeset file records whether the
change is a `patch`, `minor`, or `major`. When you run `npm run version`, all
pending changesets are read and the highest required bump wins.

### How is the changelog generated?
The changelog is generated from the text in the changeset files, not from
commits. Each changeset contributes a short release note entry.

### Does each merged PR cause a new package version?
No. Merged PRs with changesets update the release PR. A new version is published
only when the release PR is merged.

### What happens if I push to main without a changeset?
CI fails. Add a changeset in a follow-up commit and push again. Do not rewrite
history on main.

### Do I need one changeset per commit or per push?
No. You need one changeset per release-worthy change (often one per PR). A
single changeset can cover multiple commits.
