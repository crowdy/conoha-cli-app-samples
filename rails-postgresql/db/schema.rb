ActiveRecord::Schema[8.0].define(version: 2026_01_01_000000) do
  create_table "posts", force: :cascade do |t|
    t.string "title", null: false
    t.text "body"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
  end
end
