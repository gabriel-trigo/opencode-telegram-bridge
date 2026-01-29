# Release

This project is published as an npm package.

## Changesets workflow
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

## Automated releases (GitHub Actions)
This repository ships a release workflow that:
- Opens a release PR when changesets are present.
- Publishes to npm when that PR is merged.
- Creates a GitHub release tagged with the published version.

### Required setup
- Configure npm Trusted Publishing for this repo and workflow file (`release.yml`).
- The workflow requires `id-token: write` permission to publish via OIDC.
- npm CLI 11.5.1+ is required for trusted publishing.

### Flow
1. Merge changes with a changeset into `main`.
2. The workflow opens a release PR with version + changelog updates.
3. Merge the release PR to publish and create the GitHub release.

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

### Do commits or pushes equal a version?
No. A version is created only when you run `npm run version` (or when an
automated release does the same). Multiple commits can be part of one release.

### What happens if I push to main without a changeset?
CI fails. Add a changeset in a follow-up commit and push again. Do not rewrite
history on main.

### Do I need one changeset per commit or per push?
No. You need one changeset per release-worthy change (often one per PR). A
single changeset can cover multiple commits.

### When are tags created?
Tags are created when you run the release process (for example, after
`npm run version` and `npm publish`). If CI fails due to a missing changeset,
no tag is created yet.
