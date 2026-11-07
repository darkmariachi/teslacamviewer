package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func writeRecords(t *testing.T, s *Store, n int) {
	t.Helper()
	for i := 0; i < n; i++ {
		if err := s.Append(Record{Kind: KindCharge, Data: json.RawMessage(`{"chargeState":{"batteryLevel":75}}`)}); err != nil {
			t.Fatal(err)
		}
	}
}

func TestReadPageWalksFilesAndResumesFromTheCursor(t *testing.T) {
	s, _ := OpenStore(t.TempDir(), 200, 1<<20) // small files, so the records span several
	defer s.Close()
	writeRecords(t, s, 9)

	var ids []string
	cursor := Cursor{}
	for pages := 0; pages < 10; pages++ {
		page, err := s.ReadPage(cursor, 4)
		if err != nil {
			t.Fatal(err)
		}
		for _, r := range page.Records {
			ids = append(ids, r.ID)
		}
		cursor, _ = ParseCursor(page.Next)
		if !page.More {
			break
		}
	}
	if len(ids) != 9 {
		t.Fatalf("read %d records: %v", len(ids), ids)
	}
	seen := map[string]bool{}
	for _, id := range ids {
		if seen[id] {
			t.Fatalf("record %s returned twice", id)
		}
		seen[id] = true
	}
	page, _ := s.ReadPage(cursor, 4)
	if len(page.Records) != 0 || page.More {
		t.Fatalf("expected nothing new, got %d", len(page.Records))
	}
}

func TestReadPageSkipsHalfWrittenLines(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "000001.jsonl"), []byte("{\"kind\":\"body\"}\n{\"kind\":\"cha"), 0o600)
	s, _ := OpenStore(dir, 1<<20, 1<<20)
	defer s.Close()
	writeRecords(t, s, 1)

	page, _ := s.ReadPage(Cursor{}, 100)
	if len(page.Records) != 2 || page.Records[0].ID != "000001:1" || page.Records[1].ID != "000002:1" {
		t.Fatalf("got %+v", page.Records)
	}
}

func TestAckDeletesOnlyFinishedFiles(t *testing.T) {
	s, _ := OpenStore(t.TempDir(), 200, 1<<20)
	defer s.Close()
	writeRecords(t, s, 9)
	before, _ := s.numbers()

	deleted, err := s.Ack(Cursor{File: before[len(before)-1] + 5, Line: 1})
	if err != nil {
		t.Fatal(err)
	}
	after, _ := s.numbers()
	if deleted != len(before)-1 || len(after) != 1 || after[0] != s.Current() {
		t.Fatalf("deleted %d, left %v, writing %d", deleted, after, s.Current())
	}
}

func TestSyncNeedsTheToken(t *testing.T) {
	dir := t.TempDir()
	s, _ := OpenStore(dir, 1<<20, 1<<20)
	defer s.Close()
	writeRecords(t, s, 2)
	h := SyncHandler(s, "secret", filepath.Join(dir, "status.json"))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/records", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("without the token: %d", rec.Code)
	}

	req := httptest.NewRequest("GET", "/records?limit=10", nil)
	req.Header.Set("Authorization", "Bearer secret")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var page Page
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &page) != nil || len(page.Records) != 2 || page.LogID == "" {
		t.Fatalf("with the token: %d %s", rec.Code, rec.Body.String())
	}

	// An acknowledgement for another log (say, after the folder was reset) must not delete anything.
	req = httptest.NewRequest("POST", "/ack?upto=000009:1&logId=someone-else", nil)
	req.Header.Set("Authorization", "Bearer secret")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("ack for another log: %d", rec.Code)
	}
}
