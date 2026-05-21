package skills

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadDiscoversSkillMarkdown(t *testing.T) {
	dir := t.TempDir()
	skillDir := filepath.Join(dir, "writer")
	if err := os.MkdirAll(skillDir, 0755); err != nil {
		t.Fatal(err)
	}
	err := os.WriteFile(filepath.Join(skillDir, "SKILL.md"), []byte(`---
name: writer
description: Draft and rewrite office text
---

# Writer

Keep language concise.
`), 0644)
	if err != nil {
		t.Fatal(err)
	}

	got, err := LoadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 {
		t.Fatalf("len(got) = %d", len(got))
	}
	if got[0].Name != "writer" {
		t.Fatalf("Name = %q", got[0].Name)
	}
	if got[0].Description != "Draft and rewrite office text" {
		t.Fatalf("Description = %q", got[0].Description)
	}
}

func TestSelectMatchesExplicitMentionAndDescription(t *testing.T) {
	all := []Skill{
		{Name: "writer", Description: "draft rewrite text", Content: "writer body"},
		{Name: "debugger", Description: "inspect logs", Content: "debugger body"},
	}

	selected := Select(all, "please @skill:writer polish this")
	if len(selected) != 1 || selected[0].Name != "writer" {
		t.Fatalf("explicit select failed: %#v", selected)
	}

	selected = Select(all, "can you inspect this log")
	if len(selected) != 1 || selected[0].Name != "debugger" {
		t.Fatalf("description select failed: %#v", selected)
	}
}
