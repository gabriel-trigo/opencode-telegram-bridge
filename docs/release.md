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

## CI enforcement
CI fails if a relevant code change lands without a `.changeset/*.md` file.
Docs-only updates (`docs/`, `README.md`, `.github/`) do not require a changeset.
