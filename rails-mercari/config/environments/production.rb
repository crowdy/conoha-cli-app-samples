require "active_support/core_ext/integer/time"

Rails.application.configure do
  config.eager_load = true
  config.enable_reloading = false
  config.consider_all_requests_local = false
  config.public_file_server.enabled = true
  config.log_level = :info
  config.log_tags = [:request_id]
  config.action_controller.perform_caching = true
end
