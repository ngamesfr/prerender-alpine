# Changelog

## 7.5.0 - 2026-07-12

- S3 cache is now status-aware. The write moved to the `beforeSend` hook, which
  runs after `httpHeaders` has applied the page's `prerender-status-code` meta,
  so the real status code is stored in S3 object metadata and both `200` and
  `404` are cached. On a hit the stored status is replayed, so a page the app
  marks not-found is served as `404` instead of a soft `200`, and 404s stay
  cached rather than re-rendering on every crawl.

## 7.4.0 - 2026-07-12

- Add optional `S3_CACHE_TTL` (seconds) to the S3 cache plugin: a cached
  snapshot older than the TTL is treated as a miss and re-rendered, bounding
  staleness without an S3 lifecycle rule. Defaults to no expiry, preserving the
  previous behavior.
- Drop the deprecated `REDUCED_REDUNDANCY` storage class from S3 cache writes so
  the default (`STANDARD`) is used. `REDUCED_REDUNDANCY` is unsupported by
  non-AWS S3 providers (e.g. Scaleway), which rejected every PUT with
  `InvalidStorageClass` and left the cache empty.

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
