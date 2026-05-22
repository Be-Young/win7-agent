package doctemplate

import (
	"strings"
	"testing"
)

func TestBuildDraftPromptForCommonOfficeTypes(t *testing.T) {
	prompt, err := BuildDraftPrompt("meeting", "下周项目例会", "正式")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(prompt, "会议") || !strings.Contains(prompt, "下周项目例会") {
		t.Fatalf("meeting prompt = %q", prompt)
	}

	prompt, err = BuildDraftPrompt("email", "催供应商反馈报价", "礼貌")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(prompt, "邮件") || !strings.Contains(prompt, "催供应商反馈报价") {
		t.Fatalf("email prompt = %q", prompt)
	}
}

func TestBuildDraftPromptRejectsUnknownType(t *testing.T) {
	if _, err := BuildDraftPrompt("unknown", "x", "y"); err == nil {
		t.Fatal("unknown draft type should fail")
	}
}
