require_relative "boot"
require "rails"
require "active_model/railtie"
require "active_record/railtie"
require "action_controller/railtie"
require "action_view/railtie"

module ConohaRailsSample
  class Application < Rails::Application
    config.load_defaults 8.1
    config.eager_load = true
    config.secret_key_base = ENV.fetch("SECRET_KEY_BASE") { SecureRandom.hex(64) }
  end
end
