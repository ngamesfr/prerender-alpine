# Changelog

## 7.7.1 - 2026-08-20

- Log fatal errors synchronously before exiting. An `uncaughtException` or
  `unhandledRejection` writes its stack to stderr via `fs.writeSync(2, ...)` and
  then exits 1, preserving Node's default exit code. Production hit a silent exit
  1 with no output at all: `console.error` writes to the container pipe
  asynchronously, so a process that exits immediately loses its own stack trace
  and the crash is undiagnosable from the logs.

## 7.7.0 - 2026-08-20

- Renders now reuse the default browser context and a single browser-level CDP
  connection. The stock `openTab` built a throwaway browser context per request,
  which makes Chrome fork a renderer set and wire a fresh network context and
  storage partition every time, then tore it all down along with two websockets.
  Chrome 151 deadlocks the browser process partway through that setup, blocked in
  a socket write to a child (`wchan=sock_alloc_send_pskb`, zero context switches
  for the 43s until the container was killed). Port 9222 stops answering, so
  `openTab` and the DevTools endpoint hang together and only a restart recovers:
  observed at ~25 container restarts per day against ~8/day on Chrome 150.
- Because the default context outlives the render, cookies and storage are now
  cleared for the target origin before each page loads; the discarded context used
  to give that isolation for free. The smoke test renders the same page twice and
  fails if either render sees the other's state.

## 7.6.0 - 2026-08-05

- Bound the S3 cache client: 500ms connection timeout, 1s request timeout, and no
  retries. The AWS SDK applies no timeout by default, so a hung socket to the
  storage provider stalled a render for as long as the peer kept it open.
  Prerender's 10s plugin guard fires and logs `Plugin event ... timed out`, but
  the underlying promise stays pending and the request holds its render slot:
  observed renders of 10s, 21s and 1801s against a 5s `PAGE_LOAD_TIMEOUT`, which
  surfaced upstream as `504`s. Both hooks already fall through on error, so a
  timed-out read now renders normally and a timed-out write skips the cache.

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
