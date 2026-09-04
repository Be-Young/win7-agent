package config

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
)

type Config struct {
	BaseURL            string                  `json:"base_url"`
	Model              string                  `json:"model"`
	ActiveModel        string                  `json:"active_model"`
	Models             map[string]ModelProfile `json:"models"`
	APIKey             string                  `json:"api_key"`
	Stream             bool                    `json:"stream"`
	TimeoutSeconds     int                     `json:"timeout_seconds"`
	CAFile             string                  `json:"ca_file"`
	InsecureSkipVerify bool                    `json:"insecure_skip_verify"`
	Headers            map[string]string       `json:"headers"`
	AuthProfiles       map[string]AuthProfile  `json:"auth_profiles"`
	Command            CommandConfig           `json:"command"`
	Memory             MemoryConfig            `json:"memory"`
	MaxContentChars    int                     `json:"max_content_chars"`
}

type ModelProfile struct {
	BaseURL string            `json:"base_url"`
	Model   string            `json:"model"`
	APIKey  string            `json:"api_key"`
	Stream  *bool             `json:"stream,omitempty"`
	Headers map[string]string `json:"headers"`
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
	ConfirmPrefixes []string `json:"confirm_prefixes"`
	BlockedPrefixes []string `json:"blocked_prefixes"`
	AlwaysConfirm   bool     `json:"always_confirm"`
	AuditLog        string   `json:"audit_log"`
	MaxOutputBytes  int      `json:"max_output_bytes"`
	MaxToolRounds   int      `json:"max_tool_rounds"`
}

type MemoryConfig struct {
	Enabled         bool   `json:"enabled"`
	SessionFile     string `json:"session_file"`
	MaxMessages     int    `json:"max_messages"`
	MaxContextItems int    `json:"max_context_items"`
}

func Default() Config {
	return Config{
		BaseURL:         "http://127.0.0.1:8000/v1/chat/completions",
		Model:           "local-model",
		Stream:          false,
		TimeoutSeconds:  120,
		Headers:         map[string]string{},
		Models:          map[string]ModelProfile{},
		AuthProfiles:    map[string]AuthProfile{},
		MaxContentChars: 120000,
		Command: CommandConfig{
			Enabled:         true,
			ConfirmPrefixes: []string{"del", "erase", "format", "reg", "net", "netsh", "powershell", "wmic", "shutdown", "sc", "takeown", "icacls", "diskpart", "cipher"},
			BlockedPrefixes: []string{},
			AlwaysConfirm:   false,
			AuditLog:        filepath.Join("logs", "commands.log"),
			MaxOutputBytes:  65536,
			MaxToolRounds:   8,
		},
		Memory: MemoryConfig{
			Enabled:         true,
			SessionFile:     filepath.Join("sessions", "default.json"),
			MaxMessages:     40,
			MaxContextItems: 12,
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
	if cfg.Models == nil {
		cfg.Models = map[string]ModelProfile{}
	}
	if cfg.AuthProfiles == nil {
		cfg.AuthProfiles = map[string]AuthProfile{}
	}
	if cfg.MaxContentChars == 0 {
		cfg.MaxContentChars = def.MaxContentChars
	}
	if len(cfg.Command.ConfirmPrefixes) == 0 {
		cfg.Command.ConfirmPrefixes = def.Command.ConfirmPrefixes
	}
	if cfg.Command.BlockedPrefixes == nil {
		cfg.Command.BlockedPrefixes = def.Command.BlockedPrefixes
	}
	if cfg.Command.AuditLog == "" {
		cfg.Command.AuditLog = def.Command.AuditLog
	}
	if cfg.Command.MaxOutputBytes == 0 {
		cfg.Command.MaxOutputBytes = def.Command.MaxOutputBytes
	}
	if cfg.Command.MaxToolRounds <= 0 {
		cfg.Command.MaxToolRounds = def.Command.MaxToolRounds
	}
	if cfg.Memory.SessionFile == "" {
		cfg.Memory.SessionFile = def.Memory.SessionFile
	}
	if cfg.Memory.MaxMessages == 0 {
		cfg.Memory.MaxMessages = def.Memory.MaxMessages
	}
	if cfg.Memory.MaxContextItems == 0 {
		cfg.Memory.MaxContextItems = def.Memory.MaxContextItems
	}
}

func (cfg Config) ResolveModel(name string) Config {
	applyDefaults(&cfg)
	if name == "" {
		name = cfg.ActiveModel
	}
	if name == "" {
		return cfg
	}
	profile, ok := cfg.Models[name]
	if !ok {
		return cfg
	}
	if profile.BaseURL != "" {
		cfg.BaseURL = profile.BaseURL
	}
	if profile.Model != "" {
		cfg.Model = profile.Model
	}
	if profile.APIKey != "" {
		cfg.APIKey = profile.APIKey
	}
	if profile.Stream != nil {
		cfg.Stream = *profile.Stream
	}
	if profile.Headers != nil {
		merged := map[string]string{}
		for k, v := range cfg.Headers {
			merged[k] = v
		}
		for k, v := range profile.Headers {
			merged[k] = v
		}
		cfg.Headers = merged
	}
	cfg.ActiveModel = name
	return cfg
}

func DefaultConfigPath(baseDir string) string {
	return filepath.Join(baseDir, "config", "agent.json")
}

func ExampleConfigPath(baseDir string) string {
	return filepath.Join(baseDir, "config", "agent.example.json")
}
