#!/usr/bin/env bash

set -Eeuo pipefail

image="${1:?usage: smoke-test.sh IMAGE}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
suffix="${GITHUB_RUN_ID:-local}-${RANDOM}"
network="prerender-smoke-${suffix}"
fixture_container="prerender-fixture-${suffix}"
prerender_container="prerender-server-${suffix}"

cleanup() {
    status=$?
    if (( status != 0 )); then
        docker logs "${fixture_container}" || true
        docker logs "${prerender_container}" || true
    fi
    docker rm --force "${fixture_container}" "${prerender_container}" >/dev/null 2>&1 || true
    docker network rm "${network}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create "${network}" >/dev/null

docker run --detach \
    --name "${fixture_container}" \
    --network "${network}" \
    --network-alias fixture \
    --mount "type=bind,source=${script_dir},target=/smoke,readonly" \
    --entrypoint node \
    "${image}" \
    /smoke/fixture-server.js >/dev/null

docker run --detach \
    --name "${prerender_container}" \
    --network "${network}" \
    --publish 127.0.0.1:3000:3000 \
    --env BLOCK_RESOURCES=1 \
    "${image}" >/dev/null

curl_render() {
    curl \
        --fail \
        --silent \
        --show-error \
        --retry 30 \
        --retry-all-errors \
        --retry-delay 2 \
        --connect-timeout 5 \
        --max-time 120 \
        "http://localhost:3000/http://fixture:8080/$1"
}

basic_response="$(curl_render basic)"
grep --fixed-strings --quiet 'rendered-content' <<<"${basic_response}"

blocked_response="$(curl_render block-resources)"
grep --fixed-strings --quiet 'fetch-blocked:true image-blocked:true' <<<"${blocked_response}"
