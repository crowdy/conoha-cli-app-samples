class SessionsController < ApplicationController
  def create
    auth = request.env["omniauth.auth"]
    user = User.find_or_create_by!(dex_sub: auth["uid"]) do |u|
      u.email = auth["info"]["email"]
      u.name = auth["info"]["name"].presence || auth["info"]["email"].split("@").first
    end

    session[:user_id] = user.id
    redirect_to root_path, notice: "ログインしました"
  end

  def destroy
    session.delete(:user_id)
    redirect_to root_path, notice: "ログアウトしました"
  end
end
