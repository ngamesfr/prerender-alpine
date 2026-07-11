# Changelog

## 7.3.0 - 2026-07-11

Changes from the upstream fork point (`tvanro/prerender-alpine` 7.2.0):

- Publish `linux/amd64` and `linux/arm64` images to
  `ngamesfr1/prerender-alpine` from version tags, weekly rebuilds, and manual
  workflow runs, after a native-architecture render smoke test.
- Add opt-in `BLOCK_RESOURCES=1` support and smoke coverage for blocked
  analytics fetches and images.
- Move the base image from Node 22 Alpine to Node 24 LTS Alpine, while continuing
  to source Chromium from Alpine for security updates.
- Remove the obsolete `forwardHeaders` prerender option, which is a no-op in
  prerender 5.21.6.
- Replace the abandoned `prerender-aws-s3-cache` dependency and its vulnerable
  AWS SDK v2 tree with a compatible local plugin using AWS SDK v3.
- Commit the resolved npm dependency tree and install it with `npm ci`; override
  prerender's compatible `uuid` API to the fixed 11.1.1 release.
- Document that the remaining frozen upstream prerender and memory-cache pins
  are final, and that GitHub may disable scheduled workflows after 60 idle days
  in a public repository.
