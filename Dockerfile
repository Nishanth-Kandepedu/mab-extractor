# Build stage
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Production stage
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
# Install all dependencies including tsx which is needed to run server.ts
RUN npm install
COPY --from=build /app/dist ./dist
COPY --from=build /app/server.ts ./
COPY --from=build /app/firebase-applet-config.json ./
COPY --from=build /app/src ./src
COPY --from=build /app/tsconfig.json ./

EXPOSE 3000
ENV NODE_ENV=production
CMD ["npx", "tsx", "server.ts"]
