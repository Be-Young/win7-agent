package docs

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReadTextFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "note.md")
	if err := os.WriteFile(path, []byte("# Title\nhello"), 0644); err != nil {
		t.Fatal(err)
	}

	text, err := Read(path, 1000)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(text, "hello") {
		t.Fatalf("text = %q", text)
	}
}

func TestWriteNewRefusesOverwrite(t *testing.T) {
	path := filepath.Join(t.TempDir(), "out.txt")
	if err := os.WriteFile(path, []byte("old"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := WriteNew(path, []byte("new")); err == nil {
		t.Fatal("expected overwrite to be refused")
	}
}

func TestDocxRoundTripBasicText(t *testing.T) {
	path := filepath.Join(t.TempDir(), "out.docx")
	if err := WriteDocx(path, "hello\nworld"); err != nil {
		t.Fatal(err)
	}

	text, err := Read(path, 1000)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(text, "hello") || !strings.Contains(text, "world") {
		t.Fatalf("docx text = %q", text)
	}
}

func TestXlsxRoundTripBasicCells(t *testing.T) {
	path := filepath.Join(t.TempDir(), "out.xlsx")
	rows := [][]string{{"Name", "Score"}, {"Alice", "9"}}
	if err := WriteXlsx(path, "Sheet1", rows); err != nil {
		t.Fatal(err)
	}

	text, err := Read(path, 1000)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(text, "Alice") || !strings.Contains(text, "Score") {
		t.Fatalf("xlsx text = %q", text)
	}
}
