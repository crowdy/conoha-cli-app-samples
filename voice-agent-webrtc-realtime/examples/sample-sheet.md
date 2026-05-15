# Google Sheets セットアップ

## 1. シートを作成

新しいスプレッドシートを作り、1 枚目のシート名を `Orders` にする。
1 行目に以下のヘッダーを入れる:

| A | B | C | D | E | F | G | H |
|---|---|---|---|---|---|---|---|
| order_id | created_at | mode | customer_label | items_json | language | status | notes |

## 2. サービスアカウントを作成

1. Google Cloud Console でプロジェクトを作成
2. 「IAM と管理」→「サービスアカウント」で新規作成
3. キーを JSON 形式で発行しダウンロード
4. Google Sheets API を有効化

## 3. シートを共有

ダウンロードした JSON の `client_email` の値(`...@....iam.gserviceaccount.com`)を、
スプレッドシートの「共有」で **編集者** として追加する。

## 4. 環境変数

- `SHEET_ID`: スプレッドシート URL の `/d/` と `/edit` の間の文字列
- `GOOGLE_APPLICATION_CREDENTIALS_JSON`: JSON ファイルの中身を **1 行に** して貼り付け

## 5. (任意) モード別の色分け

`C` 列(mode)に条件付き書式を設定するとデモ映えする:
- `emergency` → 赤背景
- `military` → 緑背景
- `callcenter` → 青背景
