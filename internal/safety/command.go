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

type cappedBuffer struct {
	buf       bytes.Buffer
	limit     int
	truncated bool
}

func (b *cappedBuffer) Write(p []byte) (int, error) {
	written := len(p)
	if b.limit <= 0 {
		_, _ = b.buf.Write(p)
		return written, nil
	}
	remaining := b.limit - b.buf.Len()
	if remaining > 0 {
		if remaining > len(p) {
			remaining = len(p)
		}
		_, _ = b.buf.Write(p[:remaining])
	}
	if remaining < len(p) {
		b.truncated = true
	}
	return written, nil
}

func (b *cappedBuffer) String() string {
	text := b.buf.String()
	if b.truncated {
		text += "\n[output truncated]"
	}
	return text
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
	out := cappedBuffer{limit: p.MaxOutputBytes}
	cmd.Stdout = &out
	cmd.Stderr = &out
	err := cmd.Run()
	text := out.String()
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
	line := time.Now().Format(time.RFC3339) + "\t" + auditField(status) + "\t" + auditField(command) + "\n"
	f, err := os.OpenFile(p.AuditLog, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.WriteString(line)
	return err
}

func auditField(value string) string {
	replacer := strings.NewReplacer("\\", "\\\\", "\r", "\\r", "\n", "\\n", "\t", "\\t")
	return replacer.Replace(value)
}

func hasCommandPrefix(command, prefix string) bool {
	prefix = strings.ToLower(strings.TrimSpace(prefix))
	if prefix == "" {
		return false
	}
	for _, segment := range splitCommandSegments(command) {
		if commandSegmentHasPrefix(segment, prefix) {
			return true
		}
	}
	return false
}

func splitCommandSegments(command string) []string {
	var segments []string
	start := 0
	var quote byte
	escaped := false
	for i := 0; i < len(command); i++ {
		ch := command[i]
		if escaped {
			escaped = false
			continue
		}
		if ch == '^' {
			escaped = true
			continue
		}
		if quote != 0 {
			if ch == quote {
				quote = 0
			}
			continue
		}
		if ch == '"' {
			quote = ch
			continue
		}
		if strings.ContainsRune("&|;\r\n()", rune(ch)) {
			if segment := strings.TrimSpace(command[start:i]); segment != "" {
				segments = append(segments, segment)
			}
			start = i + 1
		}
	}
	if tail := strings.TrimSpace(command[start:]); tail != "" {
		segments = append(segments, tail)
	}
	return segments
}

func commandSegmentHasPrefix(segment, prefix string) bool {
	command := strings.ToLower(strings.TrimSpace(segment))
	command = strings.TrimSpace(strings.TrimLeft(command, "@"))
	if command == "" {
		return false
	}
	if matchesCommandStart(command, prefix) {
		return true
	}
	executable, rest := firstCommand(command)
	if executable == "" {
		return false
	}
	executable = strings.ReplaceAll(executable, `\`, "/")
	if slash := strings.LastIndex(executable, "/"); slash >= 0 {
		executable = executable[slash+1:]
	}
	if matchesCommandStart(executable, prefix) {
		return true
	}
	if nested := nestedWindowsCommand(executable, rest); nested != "" {
		return hasCommandPrefix(nested, prefix)
	}
	return false
}

func matchesCommandStart(command, prefix string) bool {
	if command == prefix {
		return true
	}
	if !strings.HasPrefix(command, prefix) || len(command) <= len(prefix) {
		return false
	}
	next := command[len(prefix)]
	return next == '.' || next == ' ' || next == '\t'
}

func firstCommandToken(command string) string {
	token, _ := firstCommand(command)
	return token
}

func firstCommand(command string) (string, string) {
	command = strings.TrimSpace(command)
	if command == "" {
		return "", ""
	}
	if command[0] == '\'' || command[0] == '"' {
		if end := strings.IndexByte(command[1:], command[0]); end >= 0 {
			return command[1 : end+1], strings.TrimSpace(command[end+2:])
		}
		return command[1:], ""
	}
	if end := strings.IndexAny(command, " \t"); end >= 0 {
		return command[:end], strings.TrimSpace(command[end:])
	}
	return command, ""
}

func nestedWindowsCommand(executable, rest string) string {
	name := strings.ToLower(executable)
	for _, ext := range []string{".exe", ".com", ".bat", ".cmd"} {
		name = strings.TrimSuffix(name, ext)
	}
	value := strings.TrimSpace(rest)
	if name == "call" {
		return stripOuterDoubleQuotes(value)
	}
	if name != "cmd" && name != "command" && name != "%comspec%" {
		return ""
	}
	for value != "" {
		option, remaining := firstCommand(value)
		option = strings.ToLower(option)
		if option == "/c" || option == "/k" {
			return stripOuterDoubleQuotes(remaining)
		}
		if !strings.HasPrefix(option, "/") {
			return ""
		}
		value = remaining
	}
	return ""
}

func stripOuterDoubleQuotes(value string) string {
	value = strings.TrimSpace(value)
	if len(value) >= 2 && value[0] == '"' && value[len(value)-1] == '"' {
		return value[1 : len(value)-1]
	}
	return value
}
