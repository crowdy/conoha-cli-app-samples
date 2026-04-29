# Cart Screen

## Layout

```
┌──────────────────────────────────────┐
│  Cart                                │
├──────────────────────────────────────┤
│  Item 1   $10.00   [-] 1 [+]   [×]   │
│  Item 2   $25.00   [-] 2 [+]   [×]   │
├──────────────────────────────────────┤
│  Subtotal:                  $60.00   │
│                                      │
│         [    Checkout    ]           │
└──────────────────────────────────────┘
```

## Behavior

- Quantity controls call cart-update endpoint
- Checkout button disabled when subtotal == 0
- Empty cart shows illustration + "Continue shopping" CTA
