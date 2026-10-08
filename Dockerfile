# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled code and public assets
COPY --from=builder /app/dist ./dist
COPY public/ ./public/

ENV NODE_ENV=production

EXPOSE 3000

CMD ["npm", "start"]
