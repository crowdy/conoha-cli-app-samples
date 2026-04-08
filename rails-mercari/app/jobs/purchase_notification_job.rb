class PurchaseNotificationJob < ApplicationJob
  queue_as :default

  def perform(purchase_id)
    purchase = Purchase.includes(:item, :buyer, item: :seller).find(purchase_id)
    item = purchase.item
    seller = item.seller
    buyer = purchase.buyer

    Rails.logger.info(
      "[NOTIFICATION] Item '#{item.title}' (#{item.price} yen) " \
      "purchased by #{buyer.name} (#{buyer.email}). " \
      "Notifying seller #{seller.name} (#{seller.email})."
    )
  end
end
