# Google Sheets セットアップ

1. 空のスプレッドシートを作成。タブ名を `orders` にする。
2. 1 行目に次のヘッダーを入れる:
   `order_id | created_at | updated_at | mode | language | items | customer_label | notes | status`
3. GCP プロジェクトでサービスアカウントを作成、JSON キーをダウンロード。
4. スプレッドシートの「共有」でサービスアカウントのメールアドレスを **編集者**
   として追加。
5. URL の `https://docs.google.com/spreadsheets/d/<ID>/edit` から `<ID>` を取得。
6. `.env` に `SHEET_ID=<ID>`、`GOOGLE_APPLICATION_CREDENTIALS_JSON='{"type":...}'`
   (改行を消した 1 行) を設定。
