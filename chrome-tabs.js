'use strict';

const CDP = require('chrome-remote-interface');
const chrome = require('prerender/lib/browsers/chrome');
const health = require('./health');
const server = require('prerender/lib/server');
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

// Every teardown step talks to a browser that may already be wedged, and a hang here
// would strand the render slot it is trying to free.
const TEARDOWN_TIMEOUT = 2000;

function teardownStep(run, label, targetId) {
    return Promise.race([
        Promise.resolve().then(run),
        new Promise((resolve) => setTimeout(resolve, TEARDOWN_TIMEOUT))
    ]).catch((err) => util.log('teardown step failed', label, targetId, err));
}

// Closing a target still holding a paused request deadlocks the browser process in a
// write to its renderer, and detaching the listeners first guarantees nobody will ever
// answer that request. So release the queue before letting go of it.
async function discardTab(targetId, tab, browser) {
    if (tab) {
        await teardownStep(() => tab.Fetch.disable(), 'Fetch.disable', targetId);
        await teardownStep(() => tab.Page.stopLoading(), 'Page.stopLoading', targetId);
        tab.removeAllListeners();
    }

    try {
        await teardownStep(() => browser.Target.closeTarget({ targetId }), 'Target.closeTarget', targetId);
    } finally {
        if (tab) {
            await teardownStep(() => tab.close(), 'tab.close', targetId);
        }
    }
}

// prerender's 60s watchdog gives a hung render up without closing the target it
// opened, which is the whole leak: an about:blank target left in the shared context,
// where Chrome packs same-site targets into a handful of renderers and a stuck page
// starves every render on that main thread. Prod reached 41 of them. Hook the moment
// the library abandons the request rather than running a second timer against a
// threshold of our own; targetId is cleared by closeTab, so this only sees leaks.
const removeRequestFromInFlight = server.removeRequestFromInFlight;

server.removeRequestFromInFlight = function (req) {
    const prerender = req && req.prerender;
    const abandoned = prerender && prerender.targetId;

    if (abandoned) {
        const { targetId, tab } = prerender;

        prerender.targetId = null;

        discardAbandonedTarget(targetId, tab).catch((err) => util.log('unable to close abandoned target', targetId, err));
    }

    // Called again from the chain's finally, and skipped for cache hits, which never
    // reach Chrome and so say nothing about whether it still renders. A render that
    // never got a tab failed just as surely as one that was abandoned holding it.
    if (prerender && prerender.usedChrome && !prerender.outcomeRecorded) {
        prerender.outcomeRecorded = true;
        health.recordOutcome(Boolean(abandoned) || !prerender.tab);
    }

    return removeRequestFromInFlight.call(this, req);
};

async function discardAbandonedTarget(targetId, tab) {
    if (!browserPromise) {
        return;
    }

    await discardTab(targetId, tab, await browserPromise);
    util.log('closed abandoned target', targetId);
}

const connect = chrome.connect;

chrome.connect = function () {
    browserPromise = null;

    return connect.call(this);
};

// Chrome deadlocks inside Target.createTarget when several arrive together, blocked
// writing to a renderer, and never recovers: every wedge so far began on a burst of
// concurrent creations, a full minute before the watchdog noticed. Serialising them
// removes that concurrency, and the timeout turns a hang into a fast failure rather
// than a render slot held for the library's whole 60s.
const CREATE_TARGET_TIMEOUT = 10000;

let createQueue = Promise.resolve();

function createTarget(browser, url) {
    const next = createQueue.catch(() => {}).then(() =>
        Promise.race([
            browser.Target.createTarget({ url: 'about:blank' }),
            new Promise((resolve, reject) => {
                setTimeout(() => reject(new Error(`Target.createTarget timed out after ${CREATE_TARGET_TIMEOUT}ms for ${url}`)), CREATE_TARGET_TIMEOUT);
            })
        ])
    );

    createQueue = next.catch(() => {});

    return next;
}

chrome.openTab = async function (options) {
    const url = options.url;

    // Set before the first thing that can hang, so a render that never gets a target
    // still reaches the health marker as a failure.
    options.usedChrome = true;

    const browser = await getBrowser(this, url);
    const { targetId } = await createTarget(browser, url);

    // Own the target from the moment it exists: the library only records it once
    // openTab resolves, so a hang in here would otherwise leave nobody to close it.
    options.targetId = targetId;

    const tab = await connectWithRetry(targetId, this.options.browserDebuggingPort, url);

    options.tab = tab;

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
    if (tab.prerender) {
        tab.prerender.targetId = null;
    }

    await discardTab(tab.target, tab, tab.browser);
};
