# Purchase Flow

```mermaid
sequenceDiagram
  actor U as User
  participant W as Web
  participant C as Checkout API
  participant P as Payment Provider

  U->>W: click "Purchase"
  W->>C: POST /v1/checkout
  C->>P: charge card
  P-->>C: ok | declined
  C-->>W: 200 | 402
```

## Localization

See [i18n notes](./i18n.md) for currency formatting and locale-aware labels.

## Error cases

- E_PAY_01: card declined → show retry option
- E_PAY_02: insufficient funds → suggest alternate payment method
