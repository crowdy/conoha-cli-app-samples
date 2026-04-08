require_relative "boot"
require "rails"
require "active_model/railtie"
require "active_record/railtie"
require "active_job/railtie"
require "action_controller/railtie"
require "action_view/railtie"

module MercariApp
  class Application < Rails::Application
    config.load_defaults 8.1
    config.secret_key_base = ENV.fetch("SECRET_KEY_BASE")
    config.active_job.queue_adapter = :sidekiq
  end
end
