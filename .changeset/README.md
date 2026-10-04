# Changesets

Add one with `pnpm changeset` for any change to `@agentlens/core` that consumers see. Packages are
private (distribution is GitHub Releases), so `privatePackages` makes `changeset version` bump the
version and `changeset tag` create the `@agentlens/core@x.y.z` git tag the release workflow builds from.
