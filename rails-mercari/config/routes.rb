Rails.application.routes.draw do
  # Health check endpoint for conoha-proxy. Rails 7.1+ generates this
  # automatically with `rails new`, but this sample's routes are hand-written.
  get "up" => "rails/health#show", as: :rails_health_check

  root "items#index"
  resources :items, only: [:index, :new, :create] do
    post :buy, on: :member, to: "purchases#create"
    get :buy, on: :member, to: redirect("/")

  end
  get "/auth/dex/callback", to: "sessions#create"
  get "/auth/failure", to: "sessions#failure"
  get "/logout", to: "sessions#destroy"
end
