package memory

import (
	"path/filepath"
	"testing"

	"win7-agent/internal/openai"
)

func TestSessionPersistsMessagesAndContext(t *testing.T) {
	path := filepath.Join(t.TempDir(), "session.json")
	session := Session{
		Messages: []openai.Message{{Role: "user", Content: "hello"}},
		Context:  []ContextItem{{Kind: "file", Source: "notes.md", Content: "meeting notes"}},
	}
	if err := Save(path, session); err != nil {
		t.Fatal(err)
	}

	loaded, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded.Messages) != 1 || loaded.Messages[0].Content != "hello" {
		t.Fatalf("messages = %#v", loaded.Messages)
	}
	if len(loaded.Context) != 1 || loaded.Context[0].Source != "notes.md" {
		t.Fatalf("context = %#v", loaded.Context)
	}
}

func TestSessionTrimKeepsRecentItems(t *testing.T) {
	session := Session{
		Messages: []openai.Message{
			{Role: "user", Content: "1"},
			{Role: "assistant", Content: "2"},
			{Role: "user", Content: "3"},
		},
		Context: []ContextItem{
			{Kind: "file", Source: "a"},
			{Kind: "url", Source: "b"},
		},
	}

	session.Trim(2, 1)

	if len(session.Messages) != 2 || session.Messages[0].Content != "2" {
		t.Fatalf("messages = %#v", session.Messages)
	}
	if len(session.Context) != 1 || session.Context[0].Source != "b" {
		t.Fatalf("context = %#v", session.Context)
	}
}
