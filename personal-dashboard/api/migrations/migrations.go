// Package migrations exposes the SQL migration files as an embedded fs.FS so
// the binary can run migrations without relying on filesystem layout.
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
