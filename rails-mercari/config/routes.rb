Rails.application.routes.draw do
  root "items#index"
  resources :items, only: [:index, :new, :create] do
    post :buy, on: :member, to: "purchases#create"
  end
  get "/auth/dex/callback", to: "sessions#create"
  get "/auth/failure", to: "sessions#failure"
  get "/logout", to: "sessions#destroy"
end
