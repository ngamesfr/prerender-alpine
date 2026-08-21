'use strict';

const fs = require('fs');

// console.error writes to the container pipe asynchronously, so a crash that exits
// immediately loses its own stack trace: prod saw a silent exit 1 with no output.
// writeSync(2) lands before the exit. Node's default behaviour is otherwise kept.
function exitOnFatal(kind) {
    return (err) => {
        fs.writeSync(2, `${new Date().toISOString()} ${kind}: ${(err && err.stack) || err}\n`);
        process.exit(1);
    };
}

process.on('uncaughtException', exitOnFatal('uncaughtException'));
process.on('unhandledRejection', exitOnFatal('unhandledRejection'));

const prerender = require('prerender');
const prMemoryCache = require('prerender-memory-cache');

require('./chrome-tabs');

const server = prerender({
    chromeFlags: ['--no-sandbox', '--headless', '--disable-gpu', '--remote-debugging-port=9222', '--hide-scrollbars', '--disable-dev-shm-usage'],
    chromeLocation: '/usr/bin/chromium-browser'
});

const blockResources = Number(process.env.BLOCK_RESOURCES) || 0;
if (blockResources === 1) {
    server.use(require('./block-resources'));
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
