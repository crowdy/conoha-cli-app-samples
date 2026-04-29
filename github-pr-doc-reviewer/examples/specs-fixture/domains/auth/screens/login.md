# Login Screen

## Layout

```
┌────────────────────────────────┐
│        [ Tenant logo ]         │
│                                │
│  Email   [_________________]   │
│  Pass    [_________________]   │
│                                │
│           [ Sign in ]          │
│                                │
│  Forgot password?              │
└────────────────────────────────┘
```

## Behavior

- Submit calls `POST /v1/auth/login` (see [API](../api.yml))
- On 401, show inline error with `E_AUTH_01` text from glossary
- On 200, redirect to `/dashboard`

## Edge Cases

## Accessibility

- Both inputs labeled with `aria-label`
- Error region has `role="alert"`
