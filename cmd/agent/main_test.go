package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"win7-agent/internal/config"
	"win7-agent/internal/memory"
	"win7-agent/internal/openai"
)

func TestExtractActionAcceptsCaseInsensitiveFenceAndAction(t *testing.T) {
	action, ok := extractAction("before\n```Agent-Action\n{\"action\":\"RUN_COMMAND\",\"command\":\"dir\"}\n```\nafter")
	if !ok {
		t.Fatal("expected an action")
	}
	if action.Action != "run_command" || action.Command != "dir" {
		t.Fatalf("action = %#v", action)
	}
}

func TestFormatToolFeedbackPreservesOutputAndErrors(t *testing.T) {
	feedback := formatToolFeedback(agentAction{Action: "run_command", Command: "go test ./..."}, "partial output", errors.New("exit status 1"))
	for _, want := range []string{"Action: run_command", "Command: go test ./...", "Status: error", "exit status 1", "partial output"} {
		if !strings.Contains(feedback, want) {
			t.Fatalf("feedback %q does not contain %q", feedback, want)
		}
	}
}

func TestFormatToolFeedbackMarksEmptySuccessfulOutput(t *testing.T) {
	feedback := formatToolFeedback(agentAction{Action: "run_command", Command: "ver"}, "", nil)
	if !strings.Contains(feedback, "Status: ok") || !strings.Contains(feedback, "[empty]") {
		t.Fatalf("feedback = %q", feedback)
	}
}

func TestChatFeedsCommandResultBackToModel(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		var request struct {
			Messages []openai.Message `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatal(err)
		}
		content := "finished"
		if requests == 1 {
			content = "```agent-action\n{\"action\":\"run_command\",\"command\":\"echo tool-output\"}\n```"
		} else {
			found := false
			for _, message := range request.Messages {
				if strings.Contains(message.Content, "Tool result:") && strings.Contains(message.Content, "tool-output") {
					found = true
					break
				}
			}
			if !found {
				t.Fatalf("second request did not include tool output: %#v", request.Messages)
			}
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"choices": []interface{}{map[string]interface{}{
				"message": map[string]interface{}{"role": "assistant", "content": content},
			}},
		})
	}))
	defer server.Close()

	dir := t.TempDir()
	cfg := config.Default()
	cfg.BaseURL = server.URL
	cfg.Model = "test-model"
	env := runtimeEnv{
		baseDir:    dir,
		configPath: config.DefaultConfigPath(dir),
		cfg:        cfg,
		active:     cfg,
		client:     newClient(dir, cfg),
	}

	input, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	oldStdin := os.Stdin
	os.Stdin = input
	t.Cleanup(func() {
		os.Stdin = oldStdin
		_ = input.Close()
	})
	if _, err := writer.WriteString("run a tool\n/quit\n"); err != nil {
		t.Fatal(err)
	}
	_ = writer.Close()

	if err := chat(env); err != nil {
		t.Fatal(err)
	}
	if requests != 2 {
		t.Fatalf("requests = %d, want 2", requests)
	}
	session, err := memory.Load(memoryPath(env))
	if err != nil {
		t.Fatal(err)
	}
	if len(session.Messages) != 4 {
		t.Fatalf("messages = %#v", session.Messages)
	}
	if !strings.Contains(session.Messages[2].Content, "tool-output") || session.Messages[3].Content != "finished" {
		t.Fatalf("messages = %#v", session.Messages)
	}
}
