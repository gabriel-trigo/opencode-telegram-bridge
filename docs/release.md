# Release

This project is published as an npm package.

## Publish
1. Build the package:

```bash
npm run build
```

2. Bump the version:

```bash
npm version patch
```

3. Publish:

```bash
npm publish
```

The `prepublishOnly` script runs the build to ensure `dist/` is included.
