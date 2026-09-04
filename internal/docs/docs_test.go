package docs

import (
	"archive/zip"
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

func TestParseRowsReadsMarkdownTable(t *testing.T) {
	rows, err := parseRows("| Name | Score |\n| --- | --- |\n| Alice | 9 |")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 {
		t.Fatalf("rows = %#v", rows)
	}
	if rows[0][0] != "Name" || rows[0][1] != "Score" {
		t.Fatalf("header = %#v", rows[0])
	}
	if rows[1][0] != "Alice" || rows[1][1] != "9" {
		t.Fatalf("data = %#v", rows[1])
	}
}

func TestReadXlsxPreservesSparseColumnsAndRichInlineText(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sparse.xlsx")
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	zw := zip.NewWriter(file)
	sheet, err := zw.Create("xl/worksheets/sheet1.xml")
	if err != nil {
		t.Fatal(err)
	}
	_, err = sheet.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1"><c r="A1" t="inlineStr"><is><r><t>Hello</t></r><r><t> World</t></r></is></c><c r="C1" t="inlineStr"><is><t>Right</t></is></c></row>
</sheetData></worksheet>`))
	if err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}

	text, err := Read(path, 1000)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(text, "Hello World\t\tRight") {
		t.Fatalf("xlsx text = %q", text)
	}
}

func TestCellColumnParsesExcelReferences(t *testing.T) {
	for ref, want := range map[string]int{"A1": 1, "Z9": 26, "AA2": 27, "BC10": 55, "": 0} {
		if got := cellColumn(ref); got != want {
			t.Fatalf("cellColumn(%q) = %d, want %d", ref, got, want)
		}
	}
}
