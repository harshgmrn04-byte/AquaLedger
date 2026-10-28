FROM node:24.11.1-alpine
WORKDIR /app
RUN npm install --global npm@11.20.0
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json
COPY tools/import-hsb/package.json tools/import-hsb/package.json
COPY tools/bench/package.json tools/bench/package.json
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 3001
CMD ["node", "apps/server/dist/index.js"]
