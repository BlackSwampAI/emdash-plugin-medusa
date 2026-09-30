FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=development
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY medusa-config.js tsconfig.json ./
COPY src ./src
EXPOSE 19000
CMD ["npx", "medusa", "develop", "-p", "19000"]
