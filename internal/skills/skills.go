package skills

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type Skill struct {
	Name        string
	Description string
	Path        string
	Content     string
}

func LoadDir(root string) ([]Skill, error) {
	var out []Skill
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() || strings.ToLower(d.Name()) != "skill.md" {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		s := parse(path, string(data))
		out = append(out, s)
		return nil
	})
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, err
}

func Select(all []Skill, input string) []Skill {
	needle := strings.ToLower(input)
	var selected []Skill
	for _, s := range all {
		name := strings.ToLower(s.Name)
		if strings.Contains(needle, "@skill:"+name) || strings.Contains(needle, "$"+name) {
			selected = append(selected, s)
			continue
		}
		if name != "" && strings.Contains(needle, name) {
			selected = append(selected, s)
			continue
		}
		for _, word := range strings.Fields(strings.ToLower(s.Description)) {
			word = strings.Trim(word, ".,;:()[]{}")
			if len(word) >= 4 && strings.Contains(needle, word) {
				selected = append(selected, s)
				break
			}
		}
	}
	return selected
}

func Prompt(selected []Skill) string {
	if len(selected) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("Active local skills. Follow these instructions when relevant.\n")
	for _, s := range selected {
		b.WriteString("\n--- skill: ")
		b.WriteString(s.Name)
		b.WriteString(" ---\n")
		b.WriteString(s.Content)
		if !strings.HasSuffix(s.Content, "\n") {
			b.WriteByte('\n')
		}
	}
	return b.String()
}

func parse(path, raw string) Skill {
	s := Skill{
		Name:    filepath.Base(filepath.Dir(path)),
		Path:    path,
		Content: raw,
	}
	trimmed := strings.TrimPrefix(raw, "\ufeff")
	if strings.HasPrefix(trimmed, "---\n") || strings.HasPrefix(trimmed, "---\r\n") {
		body := strings.TrimPrefix(strings.TrimPrefix(trimmed, "---\r\n"), "---\n")
		end := strings.Index(body, "\n---")
		if end >= 0 {
			meta := body[:end]
			for _, line := range strings.Split(meta, "\n") {
				k, v, ok := strings.Cut(line, ":")
				if !ok {
					continue
				}
				key := strings.ToLower(strings.TrimSpace(k))
				val := strings.Trim(strings.TrimSpace(v), `"'`)
				switch key {
				case "name":
					if val != "" {
						s.Name = val
					}
				case "description":
					s.Description = val
				}
			}
		}
	}
	if s.Description == "" {
		for _, line := range strings.Split(raw, "\n") {
			line = strings.TrimSpace(line)
			if line != "" && !strings.HasPrefix(line, "---") && !strings.HasPrefix(line, "#") {
				s.Description = line
				break
			}
		}
	}
	return s
}
