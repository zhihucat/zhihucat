FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci --workspace backend --include-workspace-root=false --include=dev

COPY backend/tsconfig*.json ./backend/
COPY backend/src ./backend/src
RUN npm run build:backend

FROM node:22-alpine AS runtime
WORKDIR /app
COPY backend/package.json ./package.json
COPY --from=build /app/backend/dist ./dist

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4000

EXPOSE 4000

CMD ["node", "dist/server.js"]
