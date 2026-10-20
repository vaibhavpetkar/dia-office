# Dia's office as one small container. Build: docker build -t dia-office .
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY public ./public
COPY scripts ./scripts
RUN mkdir -p fixes && chown node:node fixes
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://localhost:'+process.env.PORT+'/api/health').then(r=>r.json()).then(j=>process.exit(j.db&&j.db.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
