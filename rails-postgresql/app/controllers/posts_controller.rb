class PostsController < ApplicationController
  def index
    @posts = Post.order(created_at: :desc)
    @post = Post.new
  end

  def create
    Post.create!(post_params)
    redirect_to root_path
  end

  def destroy
    Post.find(params[:id]).destroy
    redirect_to root_path
  end

  private

  def post_params
    params.require(:post).permit(:title, :body)
  end
end
