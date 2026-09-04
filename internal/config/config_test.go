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
			"confirm_prefixes": ["del", "reg"]
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
	if cfg.Command.MaxToolRounds != 8 {
		t.Fatalf("Command.MaxToolRounds = %d", cfg.Command.MaxToolRounds)
	}
	if len(cfg.Command.ConfirmPrefixes) != 2 {
		t.Fatalf("ConfirmPrefixes = %#v", cfg.Command.ConfirmPrefixes)
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
	if !cfg.Command.Enabled {
		t.Fatal("command execution should be enabled by default")
	}
	if len(cfg.Command.ConfirmPrefixes) == 0 {
		t.Fatal("dangerous command confirmation prefixes should default")
	}
	if cfg.Command.AlwaysConfirm {
		t.Fatal("only dangerous commands should require confirmation by default")
	}
	if !cfg.Memory.Enabled {
		t.Fatal("memory should be enabled by default")
	}
}

func TestLoadActiveModelProfileOverridesBaseModel(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "agent.json")
	err := os.WriteFile(path, []byte(`{
		"base_url": "http://default/v1/chat/completions",
		"model": "default-model",
		"active_model": "fast",
		"models": {
			"fast": {
				"base_url": "http://fast/v1/chat/completions",
				"model": "fast-model",
				"api_key": "fast-key",
				"stream": true,
				"headers": {"X-Model": "fast"}
			}
		}
	}`), 0644)
	if err != nil {
		t.Fatal(err)
	}

	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	resolved := cfg.ResolveModel("")

	if resolved.BaseURL != "http://fast/v1/chat/completions" {
		t.Fatalf("BaseURL = %q", resolved.BaseURL)
	}
	if resolved.Model != "fast-model" {
		t.Fatalf("Model = %q", resolved.Model)
	}
	if resolved.APIKey != "fast-key" {
		t.Fatalf("APIKey = %q", resolved.APIKey)
	}
	if !resolved.Stream {
		t.Fatal("Stream should be inherited from profile")
	}
	if resolved.Headers["X-Model"] != "fast" {
		t.Fatalf("Headers = %#v", resolved.Headers)
	}
}
