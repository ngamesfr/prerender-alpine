'use strict';

const http = require('http');

const basicFixture = `<!doctype html>
<html>
<body>
    <div id="result">waiting</div>
    <script>
        window.prerenderReady = false;
        document.getElementById('result').textContent = 'rendered-content';
        window.prerenderReady = true;
    </script>
</body>
</html>`;

const blockResourcesFixture = `<!doctype html>
<html>
<body>
    <div id="result">waiting</div>
    <script>
        window.prerenderReady = false;

        const analyticsFetch = fetch('https://www.google-analytics.com/g/collect', {
            method: 'POST',
            mode: 'no-cors',
            body: 'smoke-test=1'
        }).then(() => false, () => true);

        const imageLoad = new Promise((resolve) => {
            const image = new Image();
            image.onload = () => resolve(false);
            image.onerror = () => resolve(true);
            image.src = '/fixture.png';
        });

        const timeout = setTimeout(() => {
            document.getElementById('result').textContent = 'resource-check-timeout';
            window.prerenderReady = true;
        }, 10000);

        Promise.all([analyticsFetch, imageLoad]).then(([fetchBlocked, imageBlocked]) => {
            clearTimeout(timeout);
            document.getElementById('result').textContent =
                'fetch-blocked:' + fetchBlocked + ' image-blocked:' + imageBlocked;
            window.prerenderReady = true;
        });
    </script>
</body>
</html>`;

const storageFixture = `<!doctype html>
<html>
<body>
    <div id="result">waiting</div>
    <script>
        window.prerenderReady = false;

        const storageSeen = localStorage.getItem('smoke-visited') === 'true';
        const cookieSeen = document.cookie.includes('smoke-visited=true');

        localStorage.setItem('smoke-visited', 'true');
        document.cookie = 'smoke-visited=true';

        document.getElementById('result').textContent =
            'storage-seen:' + storageSeen + ' cookie-seen:' + cookieSeen;
        window.prerenderReady = true;
    </script>
</body>
</html>`;

const pixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
);

http.createServer((request, response) => {
    if (request.url === '/basic') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(basicFixture);
        return;
    }

    if (request.url === '/block-resources') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(blockResourcesFixture);
        return;
    }

    if (request.url === '/storage') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(storageFixture);
        return;
    }

    if (request.url === '/fixture.png') {
        response.writeHead(200, { 'Content-Type': 'image/png' });
        response.end(pixel);
        return;
    }

    response.writeHead(404);
    response.end('not found');
}).listen(8080, '0.0.0.0');
