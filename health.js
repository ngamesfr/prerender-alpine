'use strict';

const fs = require('fs');
const util = require('prerender/lib/util.js');

// Chrome degrades without the DevTools endpoint noticing: it is served by the browser
// process, which stayed healthy while a production pod dropped 12 renders against 1
// served and kept taking traffic. Renders are the only reliable signal, so record how
// they end and let the liveness probe read the verdict off this marker.
const MARKER = '/tmp/prerender-unhealthy';
const WINDOW = 20;
const MIN_SAMPLES = 10;

const outcomes = [];
let unhealthy = false;

// A container that restarts because of the marker must not find it again on boot.
try {
    fs.unlinkSync(MARKER);
} catch (err) {
    if (err.code !== 'ENOENT') {
        util.log('unable to clear health marker', err);
    }
}

function setUnhealthy(next) {
    if (next === unhealthy) {
        return;
    }

    unhealthy = next;

    try {
        if (next) {
            fs.writeFileSync(MARKER, '');
        } else {
            fs.unlinkSync(MARKER);
        }

        util.log(next ? 'marked unhealthy: renders are not completing' : 'healthy again: renders are completing');
    } catch (err) {
        util.log('unable to update health marker', err);
    }
}

// Never throws: a bug in here must not be able to restart the fleet.
exports.recordOutcome = function (abandoned) {
    try {
        outcomes.push(Boolean(abandoned));

        if (outcomes.length > WINDOW) {
            outcomes.shift();
        }

        if (outcomes.length < MIN_SAMPLES) {
            return;
        }

        setUnhealthy(outcomes.filter(Boolean).length >= outcomes.length / 2);
    } catch (err) {
        util.log('health tracking failed', err);
    }
};
