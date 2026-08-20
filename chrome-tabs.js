'use strict';

const CDP = require('chrome-remote-interface');
const chrome = require('prerender/lib/browsers/chrome');
const util = require('prerender/lib/util.js');

const host = '127.0.0.1';

// The stock openTab builds a throwaway browser context per render, so every crawl
// forks a renderer set and wires a fresh network context and storage partition.
// Chrome 151 deadlocks the browser process partway through that setup, blocked in
// a socket write to a child, which wedges port 9222 until the liveness probe fires.
// Reusing the default context keeps the render path off that code entirely.
let browserPromise = null;

const sleep = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs));

async function connectWithRetry(target, port, url) {
    let remainingRetries = 5;

    for (;;) {
        try {
            return await CDP({ host, target, port });
        } catch (err) {
            util.log(`Cannot connect to browser port=${port} remainingRetries=${remainingRetries}, url=${url}`, err);

            if (remainingRetries <= 0) {
                throw err;
            }

            remainingRetries -= 1;
            await sleep(500);
        }
    }
}

function getBrowser(browser, url) {
    if (browserPromise) {
        return browserPromise;
    }

    const pending = connectWithRetry(browser.webSocketDebuggerURL, browser.options.browserDebuggingPort, url)
        .then((connection) => {
            // close() strips its own listeners, so this only fires when Chrome drops us.
            connection.once('disconnect', () => {
                if (browserPromise === pending) {
                    browserPromise = null;
                }
            });

            return connection;
        })
        .catch((err) => {
            if (browserPromise === pending) {
                browserPromise = null;
            }

            throw err;
        });

    browserPromise = pending;

    return pending;
}

// prerender's 60s watchdog drops a hung request without closing its tab. That used
// to leak a whole browser context; now it leaves an about:blank target in the shared
// one, where Chrome packs same-site targets into a handful of renderers and a stuck
// page starves every render sharing its main thread. Prod reached 41 of them.
// 75s, not the 5s page timeout: the S3 hooks sit in the request path behind a 10s
// guard each, so successful renders reach 41s and abandoned ones finish at ~63s,
// just after the library's own 60s watchdog gives up. Reaping earlier would turn a
// slow success into a failed crawl.
const REAP_AFTER_MS = 75000;
const REAP_EVERY_MS = 15000;
const openedAt = new Map();

async function reapOrphanedTargets() {
    if (!browserPromise) {
        return;
    }

    const browser = await browserPromise;
    const cutoff = Date.now() - REAP_AFTER_MS;

    for (const [targetId, createdAt] of openedAt) {
        if (createdAt > cutoff) {
            continue;
        }

        openedAt.delete(targetId);

        try {
            await browser.Target.closeTarget({ targetId });
            util.log('closed orphaned target', targetId);
        } catch (err) {
            util.log('unable to close orphaned target', targetId, err);
        }
    }
}

setInterval(() => {
    reapOrphanedTargets().catch((err) => util.log('target reaper failed', err));
}, REAP_EVERY_MS).unref();

const connect = chrome.connect;

chrome.connect = function () {
    browserPromise = null;
    openedAt.clear();

    return connect.call(this);
};

chrome.openTab = async function (options) {
    const url = options.url;
    const browser = await getBrowser(this, url);
    const { targetId } = await browser.Target.createTarget({ url: 'about:blank' });

    openedAt.set(targetId, Date.now());

    const tab = await connectWithRetry(targetId, this.options.browserDebuggingPort, url);

    tab.browser = browser;
    tab.prerender = options;
    tab.prerender.errors = [];
    tab.prerender.requests = {};
    tab.prerender.numRequestsInFlight = 0;

    // The default context outlives the render, so cookies and storage would leak
    // into the next one; a fresh context used to give that for free.
    try {
        await tab.Storage.clearDataForOrigin({ origin: new URL(url).origin, storageTypes: 'all' });
    } catch (err) {
        util.log('unable to clear origin data for', url, err);
    }

    return this.setUpEvents(tab);
};

chrome.closeTab = async function (tab) {
    openedAt.delete(tab.target);

    try {
        await tab.browser.Target.closeTarget({ targetId: tab.target });
    } finally {
        await tab.close();
    }
};
