package api

import (
	"errors"
	"net/http"
	"net/mail"
	"strings"
	"unicode/utf8"

	"deutschfremsprache/internal/auth"
	"deutschfremsprache/internal/store"
)

type credentials struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Name     string `json:"name"`
}

type authResponse struct {
	Token string      `json:"token"`
	User  *store.User `json:"user"`
}

func (s *Server) register(w http.ResponseWriter, r *http.Request) {
	var c credentials
	if !decodeJSON(w, r, &c) {
		return
	}
	c.Email = strings.ToLower(strings.TrimSpace(c.Email))
	c.Name = strings.TrimSpace(c.Name)
	if _, err := mail.ParseAddress(c.Email); err != nil {
		writeError(w, http.StatusBadRequest, "email không hợp lệ")
		return
	}
	if utf8.RuneCountInString(c.Password) < 8 {
		writeError(w, http.StatusBadRequest, "mật khẩu phải có ít nhất 8 ký tự")
		return
	}
	if c.Name == "" {
		c.Name, _, _ = strings.Cut(c.Email, "@")
	}
	hash, err := auth.HashPassword(c.Password)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	u, err := s.store.CreateUser(r.Context(), c.Email, c.Name, hash)
	if errors.Is(err, store.ErrConflict) {
		writeError(w, http.StatusConflict, "email này đã được đăng ký")
		return
	}
	if err != nil {
		writeStoreError(w, err)
		return
	}
	s.respondWithToken(w, http.StatusCreated, u)
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var c credentials
	if !decodeJSON(w, r, &c) {
		return
	}
	u, err := s.store.UserByEmail(r.Context(), strings.ToLower(strings.TrimSpace(c.Email)))
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		writeStoreError(w, err)
		return
	}
	if u == nil || !auth.CheckPassword(u.PasswordHash, c.Password) {
		writeError(w, http.StatusUnauthorized, "email hoặc mật khẩu không đúng")
		return
	}
	s.respondWithToken(w, http.StatusOK, u)
}

func (s *Server) respondWithToken(w http.ResponseWriter, status int, u *store.User) {
	tok, err := s.auth.Issue(u.ID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, status, authResponse{Token: tok, User: u})
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	u, err := s.store.UserByID(r.Context(), auth.UserID(r.Context()))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, u)
}
