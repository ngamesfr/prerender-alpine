'use strict';

const { GetObjectCommand, PutObjectCommand, S3Client } = require('@aws-sdk/client-s3');

const s3 = new S3Client({});

const cacheTtl = Number(process.env.S3_CACHE_TTL) || 0;

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

            const body = await result.Body.transformToByteArray();
            res.send(200, Buffer.from(body));
        }).catch(() => next());
    },

    pageLoaded(req, res, next) {
        if (req.prerender.statusCode !== 200) {
            return next();
        }

        s3.send(new PutObjectCommand({
            Bucket: process.env.S3_BUCKET_NAME,
            Key: getKey(req),
            ContentType: 'text/html;charset=UTF-8',
            Body: req.prerender.content
        })).catch((error) => {
            console.error(error);
        }).finally(next);
    }
};
