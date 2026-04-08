class CreatePurchases < ActiveRecord::Migration[8.1]
  def change
    create_table :purchases do |t|
      t.references :item, null: false, foreign_key: true, index: false
      t.references :buyer, null: false, foreign_key: { to_table: :users }
      t.datetime :purchased_at, null: false
      t.timestamps
    end
    add_index :purchases, :item_id, unique: true
  end
end
