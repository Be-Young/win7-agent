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
		_, _ = w.Write([]byte(`<html><head><title>Portal</title><meta name="description" content="Internal news"><script>bad()</script></head><body><nav>Menu noise</nav><main><h1>News</h1><p>Hello intranet</p><table><tr><th>Name</th><th>Status</th></tr><tr><td>Alice</td><td>Done</td></tr></table><a href="/x">Link</a></main></body></html>`))
	}))
	defer server.Close()

	page, err := Read(server.URL, Options{Timeout: time.Second, MaxBytes: 1 << 20})
	if err != nil {
		t.Fatal(err)
	}
	if page.Title != "Portal" {
		t.Fatalf("Title = %q", page.Title)
	}
	if page.Description != "Internal news" {
		t.Fatalf("Description = %q", page.Description)
	}
	if strings.Contains(page.Text, "bad()") {
		t.Fatalf("script leaked into text: %q", page.Text)
	}
	if strings.Contains(page.Text, "Menu noise") {
		t.Fatalf("navigation leaked into text: %q", page.Text)
	}
	if !strings.Contains(page.Text, "Hello intranet") {
		t.Fatalf("text = %q", page.Text)
	}
	if !strings.Contains(page.Text, "Name | Status") || !strings.Contains(page.Text, "Alice | Done") {
		t.Fatalf("table was not extracted readably: %q", page.Text)
	}
	if len(page.Links) != 1 || page.Links[0].Href != "/x" {
		t.Fatalf("links = %#v", page.Links)
	}
}
