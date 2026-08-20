FROM node:24-alpine

ENV CHROME_BIN=/usr/bin/chromium-browser
ENV CHROME_PATH=/usr/lib/chromium/
ENV MEMORY_CACHE=0
ENV BLOCK_RESOURCES=0

# install chromium, tini
ARG SECURITY_REFRESH=manual
RUN test -n "${SECURITY_REFRESH}" \
 && apk add --no-cache chromium tini

USER node
WORKDIR "/home/node"

COPY ./package.json ./package-lock.json ./
COPY ./server.js .
COPY ./s3-cache.js .
COPY ./chrome-tabs.js .
COPY ./health.js .

# install npm packages and clear cache
RUN npm ci --omit=dev \
 && npm cache clean --force \
 && rm -rf /var/cache/apk/* /tmp/*

EXPOSE 3000

ENTRYPOINT ["tini", "--"]
CMD ["node", "server.js"]
