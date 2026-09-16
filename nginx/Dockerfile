FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/nginx.conf
COPY conf.d/ /etc/nginx/templates/
COPY conf.d/proxy_params /etc/nginx/conf.d/proxy_params
COPY docker-entrypoint.d/40-kiraa-config.sh /docker-entrypoint.d/40-kiraa-config.sh
RUN rm -f /etc/nginx/conf.d/default.conf \
    && sed -i 's/\r$//' /docker-entrypoint.d/40-kiraa-config.sh \
    && chmod 0555 /docker-entrypoint.d/40-kiraa-config.sh
