FROM node:22-bookworm-slim

WORKDIR /app

# Herramientas para compilar dependencias nativas
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Instalar dependencias
COPY package*.json ./
RUN npm ci --omit=dev

# Copiar código de la aplicación
COPY src ./src
COPY public ./public

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "start"]
