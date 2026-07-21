# Xiaomi Gateway (mihome) listener add-on for Home Assistant
# Based on node:22-alpine
FROM node:22-alpine

WORKDIR /app

# Only install runtime deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Application source
COPY index.js run.sh options2config.js ./
COPY lib/ ./lib/

EXPOSE 9898/udp

RUN chmod +x /app/run.sh

CMD ["/app/run.sh"]
