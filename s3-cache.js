'use strict';

const { GetObjectCommand, PutObjectCommand, S3Client } = require('@aws-sdk/client-s3');

// The SDK applies no timeout by default, so a hung socket stalls the render for
// as long as the peer holds it open. Prerender's own 10s plugin guard fires but
// leaves the promise pending, so the request keeps its slot: one observed render
// took 30 minutes. Both hooks sit in the request path, and the timeouts are
// sequential (connect, then response), so the pair is spent twice per render:
// 1.5s worst case each, against a healthy round trip measured at 150-350ms.
// No retry: a failed read is a miss we render anyway and a failed write is redone
// by the next crawl, so both have a fallback cheaper than waiting.
const s3 = new S3Client({
    maxAttempts: 1,
    requestHandler: { connectionTimeout: 500, requestTimeout: 1000 }
});

const cacheTtl = Number(process.env.S3_CACHE_TTL) || 0;

// Cache only stable outcomes; storing 404 avoids re-rendering dead URLs each crawl.
const CACHEABLE_STATUS = new Set([200, 404]);

function getKey(req) {
    if (process.env.S3_PREFIX_KEY) {
        return `${process.env.S3_PREFIX_KEY}/${req.prerender.url}`;
    }

    return req.prerender.url;
}

function isFresh(lastModified) {
    if (cacheTtl <= 0) {
        return true;
    }

    if (!lastModified) {
        return false;
    }

    return Date.now() - new Date(lastModified).getTime() < cacheTtl * 1000;
}

module.exports = {
    requestReceived(req, res, next) {
        if (req.method !== 'GET') {
            return next();
        }

        s3.send(new GetObjectCommand({
            Bucket: process.env.S3_BUCKET_NAME,
            Key: getKey(req)
        })).then(async (result) => {
            if (!result.Body || !isFresh(result.LastModified)) {
                return next();
            }

            const status = Number(result.Metadata && result.Metadata['status-code']) || 200;
            const body = Buffer.from(await result.Body.transformToByteArray());
            req.prerender.fromCache = true;
            res.send(status, body);
        }).catch(() => next());
    },

    // beforeSend runs after httpHeaders sets the final status (even for 404s);
    // fromCache guards against re-writing what a hit just served.
    beforeSend(req, res, next) {
        // httpHeaders sets statusCode from a regex capture, so it can be a string.
        const status = Number(req.prerender.statusCode);
        if (req.prerender.fromCache || !CACHEABLE_STATUS.has(status)) {
            return next();
        }

        s3.send(new PutObjectCommand({
            Bucket: process.env.S3_BUCKET_NAME,
            Key: getKey(req),
            ContentType: 'text/html;charset=UTF-8',
            Metadata: { 'status-code': String(status) },
            Body: req.prerender.content
        })).catch((error) => {
            console.error(error);
        }).finally(next);
    }
};
