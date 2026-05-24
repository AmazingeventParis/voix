FROM node:24-alpine

WORKDIR /app

# Install deps first (cached layer)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY server.js rag.js faq.js logger.js scraper.js ./
COPY public ./public
COPY data ./data

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
