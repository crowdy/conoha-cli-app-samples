package handler

import (
	"net/http"

	"dashboard.crowdy.dev/api/internal/config"
)

type ShortcutsHandler struct {
	Items []config.Shortcut
}

func (h *ShortcutsHandler) Get(w http.ResponseWriter, _ *http.Request) {
	if h.Items == nil {
		h.Items = []config.Shortcut{}
	}
	writeJSON(w, http.StatusOK, h.Items)
}
