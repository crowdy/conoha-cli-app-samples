Rails.application.config.middleware.use OmniAuth::Builder do
  provider :openid_connect,
    name: :dex,
    issuer: ENV.fetch("OIDC_ISSUER", "http://dex:5556/dex"),
    scope: [:openid, :email, :profile],
    client_options: {
      identifier: ENV.fetch("OIDC_CLIENT_ID", "mercari-app"),
      secret: ENV.fetch("OIDC_CLIENT_SECRET", "mercari-dex-secret"),
      redirect_uri: ENV.fetch("OIDC_REDIRECT_URI", "http://localhost/auth/dex/callback")
    },
    discovery: true
end

OmniAuth.config.allowed_request_methods = [:post]
