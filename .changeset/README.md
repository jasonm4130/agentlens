# Changesets

Add one with `pnpm changeset` for any change to `@agentlens/core` that consumers see. Packages are
private (distribution is GitHub Releases), so `privatePackages` makes `changeset version` bump the
version and write `packages/core/CHANGELOG.md`. To release, commit that and push a `v<version>` tag:
`.github/workflows/release.yml` builds from `v*` tags only (not the `@agentlens/core@x.y.z` tags
`changeset tag` creates) and attaches the files to a draft GitHub Release whose notes quote the
changelog entry.
