package docs

import (
	"archive/zip"
	"bytes"
	"encoding/csv"
	"encoding/xml"
	"errors"
	"fmt"
	"html"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

var textExts = map[string]bool{
	".txt": true,
	".md": true,
	".csv": true,
	".json": true,
	".log": true,
}

func Read(path string, maxChars int) (string, error) {
	ext := strings.ToLower(filepath.Ext(path))
	switch {
	case textExts[ext]:
		data, err := os.ReadFile(path)
		if err != nil {
			return "", err
		}
		return limit(string(data), maxChars), nil
	case ext == ".docx":
		text, err := readDocx(path)
		return limit(text, maxChars), err
	case ext == ".xlsx":
		text, err := readXlsx(path)
		return limit(text, maxChars), err
	default:
		return "", fmt.Errorf("unsupported document type %q", ext)
	}
}

func WriteNew(path string, data []byte) error {
	if _, err := os.Stat(path); err == nil {
		return fmt.Errorf("refusing to overwrite existing file: %s", path)
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}

func WriteContent(path, content string) error {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".docx":
		return WriteDocx(path, content)
	case ".xlsx":
		rows, err := parseRows(content)
		if err != nil {
			return err
		}
		return WriteXlsx(path, "Sheet1", rows)
	default:
		return WriteNew(path, []byte(content))
	}
}

func WriteDocx(path, content string) error {
	buf := new(bytes.Buffer)
	zw := zip.NewWriter(buf)
	files := map[string]string{
		"[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
		"_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
		"word/document.xml": docxDocument(content),
	}
	for name, body := range files {
		w, err := zw.Create(name)
		if err != nil {
			return err
		}
		if _, err := io.WriteString(w, body); err != nil {
			return err
		}
	}
	if err := zw.Close(); err != nil {
		return err
	}
	return WriteNew(path, buf.Bytes())
}

func WriteXlsx(path, sheet string, rows [][]string) error {
	if sheet == "" {
		sheet = "Sheet1"
	}
	buf := new(bytes.Buffer)
	zw := zip.NewWriter(buf)
	files := map[string]string{
		"[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
		"_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
		"xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
		"xl/workbook.xml": fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="%s" sheetId="1" r:id="rId1"/></sheets></workbook>`, xmlEscape(sheet)),
		"xl/worksheets/sheet1.xml": xlsxSheet(rows),
	}
	for name, body := range files {
		w, err := zw.Create(name)
		if err != nil {
			return err
		}
		if _, err := io.WriteString(w, body); err != nil {
			return err
		}
	}
	if err := zw.Close(); err != nil {
		return err
	}
	return WriteNew(path, buf.Bytes())
}

func readDocx(path string) (string, error) {
	zr, err := zip.OpenReader(path)
	if err != nil {
		return "", err
	}
	defer zr.Close()
	var out strings.Builder
	for _, f := range zr.File {
		name := strings.ToLower(f.Name)
		if name == "word/document.xml" || strings.HasPrefix(name, "word/header") || strings.HasPrefix(name, "word/footer") {
			text, err := textFromXMLFile(f)
			if err != nil {
				return "", err
			}
			out.WriteString(text)
			out.WriteByte('\n')
		}
	}
	return strings.TrimSpace(out.String()), nil
}

func readXlsx(path string) (string, error) {
	zr, err := zip.OpenReader(path)
	if err != nil {
		return "", err
	}
	defer zr.Close()
	shared := []string{}
	for _, f := range zr.File {
		if strings.ToLower(f.Name) == "xl/sharedstrings.xml" {
			shared, err = sharedStrings(f)
			if err != nil {
				return "", err
			}
		}
	}
	var out strings.Builder
	for _, f := range zr.File {
		name := strings.ToLower(f.Name)
		if strings.HasPrefix(name, "xl/worksheets/") && strings.HasSuffix(name, ".xml") {
			out.WriteString("## ")
			out.WriteString(filepath.Base(name))
			out.WriteByte('\n')
			rows, err := worksheetRows(f, shared)
			if err != nil {
				return "", err
			}
			for _, row := range rows {
				out.WriteString(strings.Join(row, "\t"))
				out.WriteByte('\n')
			}
		}
	}
	return strings.TrimSpace(out.String()), nil
}

func textFromXMLFile(f *zip.File) (string, error) {
	rc, err := f.Open()
	if err != nil {
		return "", err
	}
	defer rc.Close()
	dec := xml.NewDecoder(rc)
	var out strings.Builder
	for {
		tok, err := dec.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", err
		}
		switch t := tok.(type) {
		case xml.CharData:
			out.WriteString(string(t))
		case xml.EndElement:
			switch strings.ToLower(t.Name.Local) {
			case "p", "tr":
				out.WriteByte('\n')
			case "tc":
				out.WriteByte('\t')
			}
		}
	}
	return strings.TrimSpace(out.String()), nil
}

func sharedStrings(f *zip.File) ([]string, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	dec := xml.NewDecoder(rc)
	var out []string
	var current strings.Builder
	inSI := false
	for {
		tok, err := dec.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			if t.Name.Local == "si" {
				inSI = true
				current.Reset()
			}
		case xml.CharData:
			if inSI {
				current.WriteString(string(t))
			}
		case xml.EndElement:
			if t.Name.Local == "si" {
				out = append(out, current.String())
				inSI = false
			}
		}
	}
	return out, nil
}

func worksheetRows(f *zip.File, shared []string) ([][]string, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	dec := xml.NewDecoder(rc)
	var rows [][]string
	var row []string
	var cellType string
	var value strings.Builder
	inValue := false
	for {
		tok, err := dec.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "row":
				row = nil
			case "c":
				cellType = ""
				for _, a := range t.Attr {
					if a.Name.Local == "t" {
						cellType = a.Value
					}
				}
			case "v", "t":
				value.Reset()
				inValue = true
			}
		case xml.CharData:
			if inValue {
				value.WriteString(string(t))
			}
		case xml.EndElement:
			switch t.Name.Local {
			case "v", "t":
				inValue = false
			case "c":
				row = append(row, cellValue(cellType, value.String(), shared))
				value.Reset()
			case "row":
				if len(row) > 0 {
					rows = append(rows, row)
				}
			}
		}
	}
	return rows, nil
}

func cellValue(cellType, raw string, shared []string) string {
	if cellType == "s" {
		idx, err := strconv.Atoi(strings.TrimSpace(raw))
		if err == nil && idx >= 0 && idx < len(shared) {
			return shared[idx]
		}
	}
	return raw
}

func docxDocument(content string) string {
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>`)
	for _, line := range strings.Split(content, "\n") {
		b.WriteString("<w:p><w:r><w:t>")
		b.WriteString(xmlEscape(line))
		b.WriteString("</w:t></w:r></w:p>")
	}
	b.WriteString(`<w:sectPr/></w:body></w:document>`)
	return b.String()
}

func xlsxSheet(rows [][]string) string {
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>`)
	for r, row := range rows {
		rowNum := r + 1
		b.WriteString(`<row r="`)
		b.WriteString(strconv.Itoa(rowNum))
		b.WriteString(`">`)
		for c, value := range row {
			b.WriteString(`<c r="`)
			b.WriteString(colName(c + 1))
			b.WriteString(strconv.Itoa(rowNum))
			b.WriteString(`" t="inlineStr"><is><t>`)
			b.WriteString(xmlEscape(value))
			b.WriteString(`</t></is></c>`)
		}
		b.WriteString(`</row>`)
	}
	b.WriteString(`</sheetData></worksheet>`)
	return b.String()
}

func parseRows(content string) ([][]string, error) {
	reader := csv.NewReader(strings.NewReader(content))
	reader.FieldsPerRecord = -1
	rows, err := reader.ReadAll()
	if err == nil && len(rows) > 0 {
		return rows, nil
	}
	var fallback [][]string
	for _, line := range strings.Split(content, "\n") {
		if strings.TrimSpace(line) != "" {
			fallback = append(fallback, []string{line})
		}
	}
	if len(fallback) == 0 {
		fallback = [][]string{{""}}
	}
	return fallback, nil
}

func colName(n int) string {
	var out []byte
	for n > 0 {
		n--
		out = append([]byte{byte('A' + n%26)}, out...)
		n /= 26
	}
	return string(out)
}

func xmlEscape(s string) string {
	var b strings.Builder
	if err := xml.EscapeText(&b, []byte(s)); err != nil {
		return html.EscapeString(s)
	}
	return b.String()
}

func limit(s string, max int) string {
	if max <= 0 {
		return s
	}
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max]) + "\n\n[content truncated]"
}
