dex_host = ENV.fetch("OIDC_EXTERNAL_HOST", "localhost")
dex_internal = ENV.fetch("OIDC_ISSUER", "http://dex:5556/dex")

Rails.application.config.middleware.use OmniAuth::Builder do
  provider :openid_connect,
    name: :dex,
    issuer: "http://#{dex_host}/dex",
    scope: [:openid, :email, :profile],
    discovery: false,
    client_options: {
      identifier: ENV.fetch("OIDC_CLIENT_ID", "mercari-app"),
      secret: ENV.fetch("OIDC_CLIENT_SECRET", "mercari-dex-secret"),
      redirect_uri: ENV.fetch("OIDC_REDIRECT_URI", "http://#{dex_host}/auth/dex/callback"),
      scheme: "http",
      host: "dex",
      port: 5556,
      authorization_endpoint: "http://#{dex_host}/dex/auth",
      token_endpoint: "#{dex_internal}/token",
      userinfo_endpoint: "#{dex_internal}/userinfo",
      jwks_uri: "#{dex_internal}/keys"
    }
end

OmniAuth.config.allowed_request_methods = [:post]
