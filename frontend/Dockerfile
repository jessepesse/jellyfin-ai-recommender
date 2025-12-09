FROM node:20-alpine AS build
WORKDIR /app/frontend

# Install dependencies
COPY frontend/package*.json ./
COPY shared ../shared
RUN npm install

# Copy sources and build
COPY frontend .
RUN npm run build

FROM nginx:stable-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
