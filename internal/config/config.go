package config

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
)

type Config struct {
	BaseURL            string                 `json:"base_url"`
	Model              string                 `json:"model"`
	APIKey             string                 `json:"api_key"`
	Stream             bool                   `json:"stream"`
	TimeoutSeconds     int                    `json:"timeout_seconds"`
	CAFile             string                 `json:"ca_file"`
	InsecureSkipVerify bool                   `json:"insecure_skip_verify"`
	Headers            map[string]string      `json:"headers"`
	AuthProfiles       map[string]AuthProfile `json:"auth_profiles"`
	Command            CommandConfig          `json:"command"`
	MaxContentChars     int                    `json:"max_content_chars"`
}

type AuthProfile struct {
	Match         string            `json:"match"`
	Headers       map[string]string `json:"headers"`
	Cookie        string            `json:"cookie"`
	BasicUsername string            `json:"basic_username"`
	BasicPassword string            `json:"basic_password"`
}

type CommandConfig struct {
	Enabled         bool     `json:"enabled"`
	AllowedPrefixes []string `json:"allowed_prefixes"`
	AlwaysConfirm   bool     `json:"always_confirm"`
	AuditLog         string   `json:"audit_log"`
	MaxOutputBytes   int      `json:"max_output_bytes"`
}

func Default() Config {
	return Config{
		BaseURL:        "http://127.0.0.1:8000/v1/chat/completions",
		Model:          "local-model",
		Stream:         false,
		TimeoutSeconds: 120,
		Headers:        map[string]string{},
		AuthProfiles:   map[string]AuthProfile{},
		MaxContentChars: 120000,
		Command: CommandConfig{
			Enabled:         false,
			AllowedPrefixes: []string{"dir", "type", "findstr", "where", "ver", "echo"},
			AlwaysConfirm:   true,
			AuditLog:         filepath.Join("logs", "commands.log"),
			MaxOutputBytes:   65536,
		},
	}
}

func Load(path string) (Config, error) {
	cfg := Default()
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return cfg, nil
		}
		return cfg, err
	}
	if err := json.Unmarshal(data, &cfg); err != nil {
		return cfg, err
	}
	applyDefaults(&cfg)
	return cfg, nil
}

func Save(path string, cfg Config) error {
	applyDefaults(&cfg)
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0644)
}

func applyDefaults(cfg *Config) {
	def := Default()
	if cfg.BaseURL == "" {
		cfg.BaseURL = def.BaseURL
	}
	if cfg.Model == "" {
		cfg.Model = def.Model
	}
	if cfg.TimeoutSeconds == 0 {
		cfg.TimeoutSeconds = def.TimeoutSeconds
	}
	if cfg.Headers == nil {
		cfg.Headers = map[string]string{}
	}
	if cfg.AuthProfiles == nil {
		cfg.AuthProfiles = map[string]AuthProfile{}
	}
	if cfg.MaxContentChars == 0 {
		cfg.MaxContentChars = def.MaxContentChars
	}
	if len(cfg.Command.AllowedPrefixes) == 0 {
		cfg.Command.AllowedPrefixes = def.Command.AllowedPrefixes
	}
	if cfg.Command.AuditLog == "" {
		cfg.Command.AuditLog = def.Command.AuditLog
	}
	if cfg.Command.MaxOutputBytes == 0 {
		cfg.Command.MaxOutputBytes = def.Command.MaxOutputBytes
	}
}

func DefaultConfigPath(baseDir string) string {
	return filepath.Join(baseDir, "config", "agent.json")
}

func ExampleConfigPath(baseDir string) string {
	return filepath.Join(baseDir, "config", "agent.example.json")
}
