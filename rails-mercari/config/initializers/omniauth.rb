# Browser-facing endpoints use the HTTPS Dex subdomain (auth.example.com)
# so the issuer claim and redirect URLs match what conoha-proxy serves.
# Server-to-server endpoints (token / userinfo / jwks) stay on the
# compose network for low-latency intra-VPC calls.
dex_issuer_host = ENV.fetch("DEX_ISSUER_HOST", "localhost")
rails_host = ENV.fetch("RAILS_HOST", "localhost")
dex_internal = ENV.fetch("OIDC_INTERNAL_ISSUER", "http://dex:5556/dex")

Rails.application.config.middleware.use OmniAuth::Builder do
  provider :openid_connect,
    name: :dex,
    issuer: "https://#{dex_issuer_host}/dex",
    scope: [:openid, :email, :profile],
    discovery: false,
    client_options: {
      identifier: ENV.fetch("OIDC_CLIENT_ID", "mercari-app"),
      secret: ENV.fetch("OIDC_CLIENT_SECRET", "mercari-dex-secret"),
      redirect_uri: "https://#{rails_host}/auth/dex/callback",
      scheme: "https",
      host: dex_issuer_host,
      port: 443,
      authorization_endpoint: "https://#{dex_issuer_host}/dex/auth",
      token_endpoint: "#{dex_internal}/token",
      userinfo_endpoint: "#{dex_internal}/userinfo",
      jwks_uri: "#{dex_internal}/keys"
    }
end

OmniAuth.config.allowed_request_methods = [:post]
