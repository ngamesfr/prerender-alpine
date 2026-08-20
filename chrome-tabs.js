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

// blockResources answers intercepted requests without awaiting them, so an event
// landing mid-teardown sends on a closing socket and rejects with nobody listening,
// which takes the process down. Detaching first means the handler cannot fire.
async function discardTab(targetId, tab, browser) {
    if (tab) {
        tab.removeAllListeners();
    }

    try {
        await browser.Target.closeTarget({ targetId });
    } finally {
        if (tab) {
            await tab.close();
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
    // reach Chrome and so say nothing about whether it still renders.
    if (prerender && prerender.usedChrome && !prerender.outcomeRecorded) {
        prerender.outcomeRecorded = true;
        health.recordOutcome(abandoned);
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

chrome.openTab = async function (options) {
    const url = options.url;
    const browser = await getBrowser(this, url);
    const { targetId } = await browser.Target.createTarget({ url: 'about:blank' });

    // Own the target from the moment it exists: the library only records it once
    // openTab resolves, so a hang in here would otherwise leave nobody to close it.
    options.targetId = targetId;
    options.usedChrome = true;

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
