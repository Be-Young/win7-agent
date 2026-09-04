package safety

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCommandsAreAllowedByDefault(t *testing.T) {
	policy := CommandPolicy{Enabled: true, ConfirmPrefixes: []string{"del", "reg"}}
	if err := policy.Validate("dir C:\\temp"); err != nil {
		t.Fatalf("dir should be allowed: %v", err)
	}
	if policy.RequiresConfirmation("dir C:\\temp") {
		t.Fatal("ordinary commands should not require confirmation")
	}
}

func TestDangerousCommandsRequireConfirmation(t *testing.T) {
	policy := CommandPolicy{Enabled: true, ConfirmPrefixes: []string{"del", "reg", "powershell"}}
	if err := policy.Validate("powershell -nop"); err != nil {
		t.Fatalf("powershell should be allowed after confirmation: %v", err)
	}
	if !policy.RequiresConfirmation("powershell -nop") {
		t.Fatal("powershell should require confirmation")
	}
	if !policy.RequiresConfirmation("del important.txt") {
		t.Fatal("del should require confirmation")
	}
}

func TestBlockedCommandsAreRejected(t *testing.T) {
	policy := CommandPolicy{Enabled: true, BlockedPrefixes: []string{"format", "diskpart"}}
	if err := policy.Validate("format c:"); err == nil {
		t.Fatal("format should be rejected when it is explicitly blocked")
	}
}

func TestCompoundCommandsCannotBypassPolicy(t *testing.T) {
	policy := CommandPolicy{
		Enabled:         true,
		BlockedPrefixes: []string{"format"},
		ConfirmPrefixes: []string{"del", "powershell"},
	}
	if err := policy.Validate("echo ready && format C:"); err == nil {
		t.Fatal("format in a compound command should be blocked")
	}
	if !policy.RequiresConfirmation("dir | powershell.exe Get-Process") {
		t.Fatal("powershell in a pipeline should require confirmation")
	}
	if policy.RequiresConfirmation(`echo "del important.txt"`) {
		t.Fatal("quoted command text should not require confirmation")
	}
	if !policy.RequiresConfirmation("echo 'safe & del important.txt'") {
		t.Fatal("single quotes must not hide Windows command separators")
	}
	if !policy.RequiresConfirmation(`cmd.exe /d /c "echo ready & del important.txt"`) {
		t.Fatal("cmd wrappers must not hide high-risk commands")
	}
	if err := policy.Validate(`cmd /c format C:`); err == nil {
		t.Fatal("cmd wrappers must not hide blocked commands")
	}
	if !policy.RequiresConfirmation(`"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile`) {
		t.Fatal("a high-risk executable path should require confirmation")
	}
}

func TestCappedBufferDiscardsExcessOutputWithoutShortWrites(t *testing.T) {
	var out cappedBuffer
	out.limit = 5
	if n, err := out.Write([]byte("1234")); err != nil || n != 4 {
		t.Fatalf("first write = %d, %v", n, err)
	}
	if n, err := out.Write([]byte("56789")); err != nil || n != 5 {
		t.Fatalf("second write = %d, %v", n, err)
	}
	if got := out.String(); got != "12345\n[output truncated]" {
		t.Fatalf("output = %q", got)
	}
}

func TestAuditEscapesControlCharacters(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "commands.log")
	policy := CommandPolicy{AuditLog: logPath}
	if err := policy.audit("echo ok\nforged", nil); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	if strings.Count(text, "\n") != 1 || !strings.Contains(text, `echo ok\nforged`) {
		t.Fatalf("audit log = %q", text)
	}
}
