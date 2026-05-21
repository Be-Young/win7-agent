package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadAppliesDefaultsAndUserConfig(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "agent.json")
	err := os.WriteFile(path, []byte(`{
		"base_url": "http://llm.internal/v1/chat/completions",
		"model": "corp-model",
		"stream": true,
		"command": {
			"enabled": true,
			"allowed_prefixes": ["dir", "type"]
		}
	}`), 0644)
	if err != nil {
		t.Fatal(err)
	}

	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}

	if cfg.BaseURL != "http://llm.internal/v1/chat/completions" {
		t.Fatalf("BaseURL = %q", cfg.BaseURL)
	}
	if cfg.Model != "corp-model" {
		t.Fatalf("Model = %q", cfg.Model)
	}
	if !cfg.Stream {
		t.Fatal("Stream should be true")
	}
	if cfg.TimeoutSeconds == 0 {
		t.Fatal("TimeoutSeconds default was not applied")
	}
	if cfg.Command.MaxOutputBytes == 0 {
		t.Fatal("Command.MaxOutputBytes default was not applied")
	}
}

func TestLoadMissingFileUsesDefaults(t *testing.T) {
	cfg, err := Load(filepath.Join(t.TempDir(), "missing.json"))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Model == "" || cfg.TimeoutSeconds == 0 || cfg.MaxContentChars == 0 {
		t.Fatalf("defaults incomplete: %#v", cfg)
	}
}
