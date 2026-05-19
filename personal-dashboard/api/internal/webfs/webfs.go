package webfs

import (
	"embed"
	"io/fs"
	"net/http"
)

//go:embed all:embed
var embedded embed.FS

func FS() http.FileSystem {
	sub, err := fs.Sub(embedded, "embed")
	if err != nil {
		panic(err)
	}
	return http.FS(sub)
}
