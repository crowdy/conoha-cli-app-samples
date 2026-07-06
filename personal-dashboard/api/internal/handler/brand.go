package handler

import "net/http"

type BrandHandler struct {
	Name string
}

func (h *BrandHandler) Get(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"label": h.Name})
}
