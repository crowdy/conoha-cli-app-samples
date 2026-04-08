Rails.application.routes.draw do
  root "items#index"
  resources :items, only: [:index, :new, :create] do
    post :buy, on: :member
  end
  get "/auth/dex/callback", to: "sessions#create"
  get "/logout", to: "sessions#destroy"
end
