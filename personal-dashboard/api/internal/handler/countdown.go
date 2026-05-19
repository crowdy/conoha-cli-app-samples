package handler

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"dashboard.crowdy.dev/api/internal/countdown"
)

type CountdownHandler struct {
	Repo *countdown.Repo
	Now  func() time.Time
}

func (h *CountdownHandler) now() time.Time {
	if h.Now != nil {
		return h.Now()
	}
	return time.Now()
}

func (h *CountdownHandler) List(w http.ResponseWriter, r *http.Request) {
	items, err := h.Repo.ListFuture(r.Context(), h.now())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if items == nil {
		items = []countdown.Countdown{}
	}
	writeJSON(w, http.StatusOK, items)
}

func (h *CountdownHandler) Create(w http.ResponseWriter, r *http.Request) {
	var body struct {
		TargetAt string `json:"target_at"`
		Label    string `json:"label"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	t, err := time.Parse(time.RFC3339, body.TargetAt)
	if err != nil {
		writeError(w, http.StatusBadRequest, "target_at must be RFC3339")
		return
	}
	c, err := h.Repo.Create(r.Context(), t, body.Label, h.now())
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, c)
}

func (h *CountdownHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad id")
		return
	}
	if err := h.Repo.Delete(r.Context(), id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
