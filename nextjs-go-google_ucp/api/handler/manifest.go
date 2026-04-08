package handler

import (
	"encoding/json"
	"net/http"

	"github.com/crowdy/conoha-cli-app-samples/nextjs-go-google_ucp/api/ucp"
)

func Manifest(w http.ResponseWriter, r *http.Request) {
	endpoint := r.Header.Get("X-Forwarded-Host")
	if endpoint == "" {
		endpoint = "http://localhost/api/"
	} else {
		endpoint = "http://" + endpoint + "/api/"
	}

	manifest := ucp.BuildManifest(endpoint)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	json.NewEncoder(w).Encode(manifest)
}
