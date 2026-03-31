FROM ruby:3.3-slim AS builder
WORKDIR /app
RUN apt-get update -qq && apt-get install -y build-essential libpq-dev
COPY Gemfile Gemfile.lock ./
RUN bundle install --jobs 4

FROM ruby:3.3-slim
WORKDIR /app
RUN apt-get update -qq && apt-get install -y libpq5 && rm -rf /var/lib/apt/lists/*
COPY --from=builder /usr/local/bundle /usr/local/bundle
COPY . .
RUN chmod +x bin/docker-entrypoint
ENV RAILS_ENV=production
EXPOSE 3000
ENTRYPOINT ["bin/docker-entrypoint"]
CMD ["bundle", "exec", "puma", "-b", "tcp://0.0.0.0:3000"]
