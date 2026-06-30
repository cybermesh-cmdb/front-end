FROM nginx:1.27-alpine

# Remove configuração padrão do nginx
RUN rm /etc/nginx/conf.d/default.conf

# Copia configuração customizada
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copia os arquivos estáticos do frontend
COPY . /usr/share/nginx/html/

# Gera token de versao para cache-busting automatico em cada build
ARG BUILD_VERSION=dev
RUN BUILD_TOKEN="$BUILD_VERSION"; \
	if [ "$BUILD_TOKEN" = "dev" ]; then BUILD_TOKEN="$(date +%Y%m%d%H%M%S)"; fi; \
	find /usr/share/nginx/html -maxdepth 1 -name "*.html" -exec sed -i "s/__BUILD_VERSION__/${BUILD_TOKEN}/g" {} +; \
	echo "$BUILD_TOKEN" > /usr/share/nginx/html/.build-version

EXPOSE 80
