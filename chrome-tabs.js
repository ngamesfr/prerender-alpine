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

const connect = chrome.connect;

chrome.connect = function () {
    browserPromise = null;

    return connect.call(this);
};

chrome.openTab = async function (options) {
    const url = options.url;
    const browser = await getBrowser(this, url);
    const { targetId } = await browser.Target.createTarget({ url: 'about:blank' });
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
    try {
        await tab.browser.Target.closeTarget({ targetId: tab.target });
    } finally {
        await tab.close();
    }
};
