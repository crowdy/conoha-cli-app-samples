FROM composer:2 AS deps
WORKDIR /app
COPY composer.json ./
RUN composer install --no-dev --no-scripts --prefer-dist

FROM php:8.3-apache
RUN docker-php-ext-install pdo_mysql
RUN a2enmod rewrite
ENV APACHE_DOCUMENT_ROOT=/var/www/html/public
RUN sed -ri -e 's!/var/www/html!${APACHE_DOCUMENT_ROOT}!g' /etc/apache2/sites-available/*.conf \
    && sed -ri -e 's!/var/www/!${APACHE_DOCUMENT_ROOT}!g' /etc/apache2/apache2.conf /etc/apache2/conf-available/*.conf \
    && sed -ri -e 's/AllowOverride None/AllowOverride All/g' /etc/apache2/apache2.conf
WORKDIR /var/www/html
COPY --from=deps /app/vendor ./vendor
COPY . .
RUN chown -R www-data:www-data storage bootstrap/cache 2>/dev/null || true
RUN chmod +x bin/docker-entrypoint
EXPOSE 80
ENTRYPOINT ["bin/docker-entrypoint"]
CMD ["apache2-foreground"]
