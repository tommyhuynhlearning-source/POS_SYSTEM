FROM node:22-alpine AS build
ARG VITE_CURRENCY=USD
ARG VITE_TIMEZONE=UTC
ENV VITE_CURRENCY=$VITE_CURRENCY VITE_TIMEZONE=$VITE_TIMEZONE
WORKDIR /app
COPY package.json ./
RUN npm install
COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
RUN npm run build
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
