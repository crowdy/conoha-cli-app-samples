class CreateItems < ActiveRecord::Migration[8.1]
  def change
    create_table :items do |t|
      t.string :title, null: false
      t.text :description
      t.integer :price, null: false
      t.integer :status, null: false, default: 0
      t.references :seller, null: false, foreign_key: { to_table: :users }
      t.timestamps
    end
  end
end
