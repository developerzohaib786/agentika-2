FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY src ./src
COPY public ./public
ENV NODE_ENV=production PORT=3000 LOG_FILE=/var/log/backend/app.log
EXPOSE 3000
CMD ["node", "src/index.js"]
