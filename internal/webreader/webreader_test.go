package webreader

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestReadExtractsStaticHTML(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(`<html><head><title>Portal</title><script>bad()</script></head><body><h1>News</h1><p>Hello intranet</p><a href="/x">Link</a></body></html>`))
	}))
	defer server.Close()

	page, err := Read(server.URL, Options{Timeout: time.Second, MaxBytes: 1 << 20})
	if err != nil {
		t.Fatal(err)
	}
	if page.Title != "Portal" {
		t.Fatalf("Title = %q", page.Title)
	}
	if strings.Contains(page.Text, "bad()") {
		t.Fatalf("script leaked into text: %q", page.Text)
	}
	if !strings.Contains(page.Text, "Hello intranet") {
		t.Fatalf("text = %q", page.Text)
	}
	if len(page.Links) != 1 || page.Links[0].Href != "/x" {
		t.Fatalf("links = %#v", page.Links)
	}
}
