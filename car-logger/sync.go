package main

import (
	"bytes"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Cursor points just past a line in a log file: "000002:5" means "lines 1 to 5 of file 2 are read".
type Cursor struct {
	File int
	Line int
}

func (c Cursor) String() string { return fmt.Sprintf("%06d:%d", c.File, c.Line) }

func ParseCursor(s string) (Cursor, error) {
	if s == "" {
		return Cursor{}, nil
	}
	file, line, ok := strings.Cut(s, ":")
	f, err1 := strconv.Atoi(file)
	l, err2 := strconv.Atoi(line)
	if !ok || err1 != nil || err2 != nil || f < 0 || l < 0 {
		return Cursor{}, fmt.Errorf("bad cursor %q", s)
	}
	return Cursor{File: f, Line: l}, nil
}

// Page is one answer to a records request.
type Page struct {
	// LogID changes when the log folder is started afresh, so a collector knows to forget its cursor.
	LogID   string       `json:"logId"`
	Records []PageRecord `json:"records"`
	Next    string       `json:"next"`
	More    bool         `json:"more"`
}

type PageRecord struct {
	ID     string          `json:"id"`
	Record json.RawMessage `json:"record"`
}

// ReadPage returns up to limit records after the cursor. Only complete lines count: the newest file may
// be half-way through a write, and an older one may end in a line cut short by a power loss.
func (s *Store) ReadPage(after Cursor, limit int) (Page, error) {
	page := Page{LogID: s.logID, Records: []PageRecord{}, Next: after.String()}
	numbers, err := s.numbers()
	if err != nil {
		return page, err
	}
	for _, n := range numbers {
		if n < after.File {
			continue
		}
		data, err := os.ReadFile(filepath.Join(s.dir, fileName(n)))
		if errors.Is(err, os.ErrNotExist) {
			continue // pruned while we looked
		}
		if err != nil {
			return page, err
		}
		if end := bytes.LastIndexByte(data, '\n'); end >= 0 {
			data = data[:end+1]
		} else {
			data = nil
		}
		lines := bytes.Split(bytes.TrimSuffix(data, []byte("\n")), []byte("\n"))
		if len(data) == 0 {
			lines = nil
		}
		start := 0
		if n == after.File {
			start = after.Line
		}
		for i := start; i < len(lines); i++ {
			if len(page.Records) >= limit {
				page.More = true
				return page, nil
			}
			cursor := Cursor{File: n, Line: i + 1}
			page.Next = cursor.String()
			if json.Valid(lines[i]) {
				page.Records = append(page.Records, PageRecord{ID: cursor.String(), Record: json.RawMessage(lines[i])})
			}
		}
	}
	return page, nil
}

// Ack deletes the files a collector has finished with: every file before the cursor's. The file the
// cursor is in, and the one being written, stay.
func (s *Store) Ack(upto Cursor) (int, error) {
	numbers, err := s.numbers()
	if err != nil {
		return 0, err
	}
	deleted := 0
	for _, n := range numbers {
		if n >= upto.File || n == s.Current() {
			break
		}
		if err := os.Remove(filepath.Join(s.dir, fileName(n))); err != nil && !errors.Is(err, os.ErrNotExist) {
			return deleted, err
		}
		deleted++
	}
	return deleted, nil
}

// LoadOrCreateSecret reads a random value from a file, creating it on first use: the sync token
// TeslaCam must present, and the log id.
func LoadOrCreateSecret(path string) (string, error) {
	if b, err := os.ReadFile(path); err == nil {
		if t := strings.TrimSpace(string(b)); t != "" {
			return t, nil
		}
	}
	buf := make([]byte, 20)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	token := hex.EncodeToString(buf)
	return token, os.WriteFile(path, []byte(token+"\n"), 0o600)
}

// SyncHandler serves the log to TeslaCam on the home network. Every request needs the token, because
// the log says where the car has been.
func SyncHandler(store *Store, token, statusPath string) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /records", func(w http.ResponseWriter, r *http.Request) {
		after, err := ParseCursor(r.URL.Query().Get("after"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		if limit <= 0 || limit > 2000 {
			limit = 500
		}
		page, err := store.ReadPage(after, limit)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(page)
	})
	mux.HandleFunc("POST /ack", func(w http.ResponseWriter, r *http.Request) {
		upto, err := ParseCursor(r.URL.Query().Get("upto"))
		if err != nil || r.URL.Query().Get("logId") != store.logID {
			http.Error(w, "bad cursor or log", http.StatusBadRequest)
			return
		}
		deleted, err := store.Ack(upto)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]int{"deleted": deleted})
	})
	mux.HandleFunc("GET /status", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		http.ServeFile(w, r, statusPath)
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		given, _ := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if subtle.ConstantTimeCompare([]byte(given), []byte(token)) != 1 {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		mux.ServeHTTP(w, r)
	})
}
