package safety

import "testing"

func TestAllowedCommandPrefixes(t *testing.T) {
	policy := CommandPolicy{Enabled: true, AllowedPrefixes: []string{"dir", "type"}}
	if err := policy.Validate("dir C:\\temp"); err != nil {
		t.Fatalf("dir should be allowed: %v", err)
	}
	if err := policy.Validate("powershell -nop"); err == nil {
		t.Fatal("powershell should be rejected")
	}
	if err := policy.Validate("del important.txt"); err == nil {
		t.Fatal("del should be rejected")
	}
}
