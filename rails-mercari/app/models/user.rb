class User < ApplicationRecord
  has_many :items, foreign_key: :seller_id, dependent: :destroy
  has_many :purchases, foreign_key: :buyer_id, dependent: :destroy

  validates :email, presence: true, uniqueness: true
  validates :name, presence: true
  validates :dex_sub, presence: true, uniqueness: true
end
