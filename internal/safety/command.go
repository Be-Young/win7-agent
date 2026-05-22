package safety

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

type CommandPolicy struct {
	Enabled         bool
	ConfirmPrefixes []string
	BlockedPrefixes []string
	AuditLog        string
	MaxOutputBytes  int
}

func (p CommandPolicy) Validate(command string) error {
	command = strings.TrimSpace(command)
	if command == "" {
		return errors.New("empty command")
	}
	if !p.Enabled {
		return errors.New("command execution is disabled")
	}
	lower := strings.ToLower(command)
	for _, blocked := range p.BlockedPrefixes {
		if hasCommandPrefix(lower, blocked) {
			return fmt.Errorf("command prefix %q is blocked", strings.TrimSpace(blocked))
		}
	}
	return nil
}

func (p CommandPolicy) RequiresConfirmation(command string) bool {
	lower := strings.ToLower(strings.TrimSpace(command))
	for _, confirm := range p.ConfirmPrefixes {
		if hasCommandPrefix(lower, confirm) {
			return true
		}
	}
	return false
}

func (p CommandPolicy) Run(ctx context.Context, command string) (string, error) {
	if err := p.Validate(command); err != nil {
		return "", err
	}
	timeoutCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.CommandContext(timeoutCtx, "cmd.exe", "/C", command)
	} else {
		cmd = exec.CommandContext(timeoutCtx, "/bin/sh", "-c", command)
	}
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	err := cmd.Run()
	text := out.String()
	if p.MaxOutputBytes > 0 && len(text) > p.MaxOutputBytes {
		text = text[:p.MaxOutputBytes] + "\n[output truncated]"
	}
	_ = p.audit(command, err)
	return text, err
}

func (p CommandPolicy) audit(command string, runErr error) error {
	if p.AuditLog == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(p.AuditLog), 0755); err != nil {
		return err
	}
	status := "ok"
	if runErr != nil {
		status = runErr.Error()
	}
	line := time.Now().Format(time.RFC3339) + "\t" + status + "\t" + command + "\n"
	f, err := os.OpenFile(p.AuditLog, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.WriteString(line)
	return err
}

func hasCommandPrefix(command, prefix string) bool {
	prefix = strings.ToLower(strings.TrimSpace(prefix))
	if command == "" || prefix == "" {
		return false
	}
	return command == prefix || strings.HasPrefix(command, prefix+" ") || strings.HasPrefix(command, prefix+".")
}
