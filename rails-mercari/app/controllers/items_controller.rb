class ItemsController < ApplicationController
  before_action :require_login, only: [:new, :create]

  def index
    @items = Item.includes(:seller).order(created_at: :desc)
    @item = Item.new
  end

  def new
    @item = Item.new
  end

  def create
    @item = current_user.items.build(item_params)
    if @item.save
      redirect_to root_path, notice: "出品しました"
    else
      render :new, status: :unprocessable_entity
    end
  end

  private

  def item_params
    params.require(:item).permit(:title, :description, :price)
  end
end
