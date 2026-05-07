FROM alpine:3.20

RUN apk add --no-cache postgresql16-client python3 py3-bcrypt openssl

COPY schema.pgsql.sql /schema.pgsql.sql
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
