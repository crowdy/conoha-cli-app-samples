class CreateUsers < ActiveRecord::Migration[8.1]
  def change
    create_table :users do |t|
      t.string :email, null: false
      t.string :name, null: false
      t.string :dex_sub, null: false
      t.timestamps
    end
    add_index :users, :dex_sub, unique: true
    add_index :users, :email, unique: true
  end
end
