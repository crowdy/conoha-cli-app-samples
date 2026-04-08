class PurchasesController < ApplicationController
  before_action :require_login

  def create
    @item = Item.lock.find(params[:id])

    if @item.seller == current_user
      redirect_to root_path, alert: "自分の商品は購入できません"
      return
    end

    if @item.sold?
      redirect_to root_path, alert: "この商品は売り切れです"
      return
    end

    ActiveRecord::Base.transaction do
      @item.sold!
      Purchase.create!(
        item: @item,
        buyer: current_user,
        purchased_at: Time.current
      )
    end

    redirect_to root_path, notice: "購入しました！"
  rescue ActiveRecord::RecordNotUnique
    redirect_to root_path, alert: "この商品は売り切れです"
  end
end
