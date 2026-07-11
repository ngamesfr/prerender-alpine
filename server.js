'use strict';

const prerender = require('prerender');
const prMemoryCache = require('prerender-memory-cache');

const server = prerender({
    chromeFlags: ['--no-sandbox', '--headless', '--disable-gpu', '--remote-debugging-port=9222', '--hide-scrollbars', '--disable-dev-shm-usage'],
    chromeLocation: '/usr/bin/chromium-browser'
});

const blockResources = Number(process.env.BLOCK_RESOURCES) || 0;
if (blockResources === 1) {
    server.use(prerender.blockResources());
}

const memCache = Number(process.env.MEMORY_CACHE) || 0;
if (memCache === 1) {
    server.use(prMemoryCache);
}

const s3Cache = Number(process.env.S3_CACHE) || 0;
if (s3Cache === 1) {
    server.use(require('./s3-cache'));
}

server.use(prerender.blacklist());
server.use(prerender.httpHeaders());
server.use(prerender.removeScriptTags());

server.start();
