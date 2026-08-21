'use strict';

const util = require('prerender/lib/util.js');

const blockedResources = [
    'google-analytics.com',
    'api.mixpanel.com',
    'fonts.googleapis.com',
    'stats.g.doubleclick.net',
    'mc.yandex.ru',
    'use.typekit.net',
    'beacon.tapfiliate.com',
    'js-agent.newrelic.com',
    'api.segment.io',
    'woopra.com',
    'static.olark.com',
    'static.getclicky.com',
    'fast.fonts.com',
    'youtube.com/embed',
    'cdn.heapanalytics.com',
    'googleads.g.doubleclick.net',
    'pagead2.googlesyndication.com',
    'fullstory.com/rec',
    'navilytics.com/nls_ajax.php',
    'log.optimizely.com/event',
    'hn.inspectlet.com',
    'tpc.googlesyndication.com',
    'partner.googleadservices.com',
    '.ttf',
    '.eot',
    '.otf',
    '.woff',
    '.png',
    '.gif',
    '.tiff',
    '.pdf',
    '.jpg',
    '.jpeg',
    '.ico',
    '.svg'
];

// Replaces the bundled plugin, which drives the deprecated Network interception
// domain. Fetch is the supported one, and only it offers a disable that releases
// whatever is still paused: closing a target on top of a paused request deadlocks
// the browser process, which is what restarted these pods ~30 times a day.
module.exports = {
    tabCreated: (req, res, next) => {
        const tab = req.prerender.tab;

        tab.Fetch.requestPaused(({ requestId, request }) => {
            const blocked = blockedResources.some((substring) => request.url.indexOf(substring) >= 0);

            const answered = blocked
                ? tab.Fetch.failRequest({ requestId, errorReason: 'Aborted' })
                : tab.Fetch.continueRequest({ requestId });

            // The tab can be torn down between the pause and the answer.
            answered.catch(() => {});
        });

        tab.Fetch.enable({ patterns: [{ urlPattern: '*' }] })
            .then(() => next())
            .catch((err) => {
                // The bundled plugin never called next() on failure, hanging the render.
                util.log('unable to enable request interception for', req.prerender.url, err);
                next();
            });
    }
};
