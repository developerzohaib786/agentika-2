FROM node:20-alpine
# acc CLI: lets rollback_to_version / restart_service operate the backend on Alternate Clouds.
RUN npm install -g @alternatefutures/acc
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY src ./src
ENV NODE_ENV=production PORT=3001
EXPOSE 3001
CMD ["node", "src/index.js"]
