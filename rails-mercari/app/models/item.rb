class Item < ApplicationRecord
  enum :status, { on_sale: 0, sold: 1 }

  belongs_to :seller, class_name: "User"
  has_one :purchase, dependent: :destroy

  validates :title, presence: true
  validates :price, presence: true, numericality: { greater_than: 0 }
end
