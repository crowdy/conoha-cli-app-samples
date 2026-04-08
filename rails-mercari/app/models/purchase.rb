class Purchase < ApplicationRecord
  belongs_to :item
  belongs_to :buyer, class_name: "User"

  after_create :enqueue_notification

  private

  def enqueue_notification
    PurchaseNotificationJob.perform_later(id)
  end
end
