# Prerender Alpine

Lightweight Prerender container built on Alpine Linux with Node and Headless Chromium.

- Prerender 5.21.6
- Node 24 LTS
- Chromium and Alpine Linux from the current `node:24-alpine` image

> [!IMPORTANT]
> The upstream `prerender` package is unmaintained and its GitHub repository has
> been deleted. Its final npm release is pinned at 5.21.6, together with the final
> published release of `prerender-memory-cache` (1.0.2). These dependency pins
> are intentional and final. The abandoned S3 cache package has been replaced by
> an equivalent local plugin using the maintained AWS SDK v3. All npm dependencies
> are committed in `package-lock.json` and installed reproducibly with `npm ci`.

## Requirements

- Docker

## Usage

Pull and run the image:

```
docker pull ngamesfr1/prerender-alpine:7.3.0
docker run -p 3000:3000 ngamesfr1/prerender-alpine:7.3.0
```
Prerender will now be running on http://localhost:3000. Try the path-style endpoint with curl:

```
curl http://localhost:3000/http://www.example.com/
```

A git tag such as `v7.3.0` publishes the `7.3.0` and `latest` image tags for
both `linux/amd64` and `linux/arm64`. The `latest` image is also rebuilt weekly
so its Alpine and Chromium packages continue to receive security fixes.
[GitHub automatically disables scheduled workflows](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows)
in a public repository after 60 days without repository activity, so check that
the workflow remains enabled if this fork is otherwise idle. Scheduled workflows
are also disabled by default on new forks.

## Prerender plugins

A few default plugins have been activated by default (see `server.js`):

- `blacklist`
- `httpHeaders`
- `removeScriptTags`

This can be modified by creating your own `server.js` and mounting this file as a docker volume:

```
docker run -p 3000:3000 -v $(pwd)/server.js:/home/node/server.js ngamesfr1/prerender-alpine:7.3.0
```

## Block resources

The built-in `blockResources` plugin is not activated by default. Enable it with
`BLOCK_RESOURCES=1` to abort analytics requests, images, and fonts while pages
are rendered. This can make renders faster and avoids generating analytics
traffic from the prerender service.

```
docker run -p 3000:3000 -e BLOCK_RESOURCES=1 ngamesfr1/prerender-alpine:7.3.0
```

## Prerender memory cache

The [prerender-memory-cache](https://github.com/prerender/prerender-memory-cache) plugin is not activated by default.
You can activate it with the environment variable `MEMORY_CACHE=1`.

You can customize cache behavior with environment variables :
- CACHE_MAXSIZE=1000 : max number of objects in cache
- CACHE_TTL=6000 : time to live in seconds

```
docker run -p 3000:3000 -e MEMORY_CACHE=1 -e CACHE_MAXSIZE=1000 -e CACHE_TTL=6000 ngamesfr1/prerender-alpine:7.3.0
```

## Prerender S3 cache

The built-in S3 cache integration is not activated by default. Enable it with
`S3_CACHE=1`. It preserves the behavior of the former
`prerender-aws-s3-cache` package while using AWS SDK v3.

You'll need to sign up with S3 compatible service and set these 3 environment variables:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `S3_BUCKET_NAME`

`S3_PREFIX_KEY` can optionally prefix every cache object key.

The deleted upstream repository is no longer a usable documentation source;
runtime options can still be inspected on the
[`prerender` npm package page](https://www.npmjs.com/package/prerender).
