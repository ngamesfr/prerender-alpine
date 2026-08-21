# Changelog

## 7.11.0 - 2026-08-21

- Pin the base image to `node:24-alpine3.23`, which carries Chromium 149 instead of
  151. Container restarts track the Chromium version closely: ~3/day across 13-16
  August on 150 (5, 0, 7, 1) against ~20/day across 17-20 August on 151 (17, 16, 26,
  23), with the step landing exactly on the version bump. The deadlock predates 151,
  so this is not expected to remove it, only to return it to the rate it ran at before.
- This trades currency for stability and is deliberate. Pinning the branch freezes the
  whole userland, not just Chromium, and 149 is two majors behind. Undo by restoring
  `FROM node:24-alpine`; nothing else depends on the pin.
- 149 was never run here: production went 150 then 151. It is the closest available
  proxy, since Alpine keeps only the current Chromium per branch and 150 is gone from
  3.24.
- Reverts 7.10.0, which was merged but never released. `chromium-headless-shell` idled
  leaner but collapsed under load: against full Chromium on identical code, URLs and
  concurrency it managed 211 renders before wedging permanently at 90 seconds, where
  Chromium did 1471 with zero abandoned. Pages timed out holding 22-23 intercepted
  requests, so the deprecated `Network` interception path stops being serviced there.
  Disabling `BLOCK_RESOURCES` avoided it, which isolates interception as the trigger.

## 7.10.0 - 2026-08-20

- Render with `chromium-headless-shell` instead of full `chromium`. Chrome 132 removed
  old headless, so `--headless` now starts a complete browser: production showed a
  `--top-chrome-webui` renderer, crashpad handlers and three idle DevTools targets that
  no prerender needs. The browser process deadlocks partway through creating a target
  in that architecture, blocked writing to a child, which is the failure this image has
  been working around since 7.7.0.
- headless-shell is the continuation of old headless at the same version and the same
  security patches, so nothing regresses on currency. It idles at 5 chromium processes
  against 10, holds no targets at rest against 3, and the image drops from 1.31GB to
  1.16GB.
- `--headless` is dropped from the flags, since the shell is only ever headless.
- The smoke test counted open targets with `grep -c`, which exits 1 on zero matches and
  under `set -e` failed the run. It only ever surfaced on headless-shell, which idles at
  zero targets, but it would equally have broken a legitimately empty full-Chrome run.

## 7.9.0 - 2026-08-20

- Report render health to the liveness probe. Chrome can degrade while the DevTools
  endpoint stays perfectly healthy, because it is served by the browser process: a
  production pod dropped 12 renders against 1 served over 15 minutes, passed every
  probe, and kept taking traffic it could not serve. Target count was considered as a
  signal and rejected, since it only catches degradation that leaks tabs, which is the
  one cause already fixed.
- Outcomes are recorded where the library gives up on a request. If half of the last
  20 renders were abandoned, `/tmp/prerender-unhealthy` is written and the probe fails,
  so the pod restarts itself instead of waiting to be noticed. Cache hits are ignored,
  as they never reach Chrome, and a pod with no traffic never reaches the sample floor,
  so silence is not read as sickness.
- The marker is cleared on boot so a restarted pod cannot find its own verdict and loop,
  and the tracking never throws: a bug in it must not be able to restart the fleet.

## 7.8.0 - 2026-08-20

- Close abandoned targets from the library's own give-up point instead of a second
  timer. 7.7.2 added a sweep on a 75s threshold picked here; prerender already decides
  a render is dead at its 60s watchdog and calls `removeRequestFromInFlight`, so that
  call is now wrapped and closes whatever target the request still owns. One clock
  instead of two, and no threshold of our own to justify.
- The target is recorded on the request as soon as it exists rather than when
  `openTab` resolves, so a hang inside `openTab` still leaves an owner to clean up.
  That was the actual production case: all 41 leaked targets sat at `about:blank`.

## 7.7.4 - 2026-08-20

- Detach a tab's CDP listeners before closing it. The `blockResources` plugin answers
  `Network.requestIntercepted` with `continueInterceptedRequest` without awaiting it
  or catching, so an event arriving while the tab's socket is closing rejects with
  `WebSocket is not open: readyState 2 (CLOSING)` and nobody listening. That is an
  unhandled rejection, which exits the process. 7.7.0 introduced the race by closing
  the tab's own socket, where the per-request browser connection used to be torn down
  wholesale instead. Orphaned tabs reaped on the timer now get the same treatment and
  have their client socket closed too, which it previously leaked.

## 7.7.3 - 2026-08-20

- Reap orphaned targets at 75s instead of 120s, swept every 15s instead of 60s, so
  an orphan lives at most 90s rather than 180s. The bound is set by the library's
  60s watchdog rather than by `PAGE_LOAD_TIMEOUT`: the S3 cache hooks sit in the
  request path behind a 10s plugin guard each, so production shows successful
  renders at 41s and abandoned ones completing at ~63s. Anything still open at 75s
  has already been given up on, while reaping nearer the 5s page timeout would turn
  a slow success into a failed crawl.

## 7.7.2 - 2026-08-20

- Reap orphaned targets. Prerender's 60s watchdog drops a hung request without
  closing its tab, so every hung render leaks an `about:blank` target. Before
  7.7.0 that leaked a whole browser context and went unnoticed, because the
  Chrome deadlock restarted the container every ~90 minutes and reset the count.
  With the deadlock gone a pod survives for hours and the leak accumulates:
  production reached 41 orphaned targets, at which point the pod served 1 render
  against 12 dropped, with CPU at 238m.
- Targets in the shared context are packed by Chrome into a handful of renderer
  processes, so a stuck page starves every render sitting on the same main
  thread. This is invisible to the health check: the DevTools endpoint is served
  by the browser process and keeps answering instantly, so the pod stays Ready
  and keeps taking traffic it cannot serve.
- Targets opened here are now tracked and closed once they outlive a render by a
  wide margin (120s, checked every 60s). The smoke test fails if the browser is
  left with more than a handful of targets after rendering.

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
