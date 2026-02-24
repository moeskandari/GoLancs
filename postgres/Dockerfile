FROM docker.io/postgis/postgis:16-3.4-alpine

ENV POSTGRES_USER=postgres
ENV POSTGRES_PASSWORD=group1
ENV POSTGRES_DB=group1db

# Copy initialization script with proper permissions
COPY ./init.sql /docker-entrypoint-initdb.d/01_init.sql
RUN chmod 644 /docker-entrypoint-initdb.d/01_init.sql

EXPOSE 5432
