# Alternate Clouds builds this service from the repo root; the app lives in backend/.
# (backend/Dockerfile is the same image when the service root is set to backend/.)
FROM node:20-alpine
WORKDIR /app
COPY backend/package*.json ./
RUN npm install --omit=dev
COPY backend/src ./src
COPY backend/public ./public
ENV NODE_ENV=production PORT=3000 LOG_FILE=/var/log/backend/app.log
EXPOSE 3000
CMD ["node", "src/index.js"]
