# Releasing

Releases are published by GitHub Actions. The workflow is triggered by a semantic version tag such as `v1.0.0`.

## One-time npm setup

Configure `pi-undo-tree` to trust GitHub Actions as an npm publisher. This can be done from the package's npm settings under **Trusted publishers**:

- Provider: GitHub Actions
- Repository: `ergenekonyigit/pi-undo-tree`
- Workflow: `.github/workflows/release.yml`
- Environment: leave empty

Alternatively, with a logged-in npm CLI:

```bash
npm trust github pi-undo-tree \
  --repo ergenekonyigit/pi-undo-tree \
  --file .github/workflows/release.yml \
  --allow-publish
```

The workflow uses npm trusted publishing with OIDC. No long-lived `NPM_TOKEN` secret is required.

## Release a version

1. Update `version` in `package.json` and `package-lock.json`.
2. Commit and push the version change to `main`.
3. Create and push the matching tag:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The workflow verifies that the tag matches `package.json`, runs the test suite, publishes the package to npm, and creates a GitHub release with generated release notes.
