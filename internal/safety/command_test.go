package safety

import "testing"

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
