package memory

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"time"

	"win7-agent/internal/openai"
)

type Session struct {
	UpdatedAt time.Time        `json:"updated_at"`
	Messages  []openai.Message `json:"messages"`
	Context   []ContextItem    `json:"context"`
}

type ContextItem struct {
	Kind      string    `json:"kind"`
	Source    string    `json:"source"`
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"created_at"`
}

func Load(path string) (Session, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return Session{}, nil
		}
		return Session{}, err
	}
	var session Session
	if err := json.Unmarshal(data, &session); err != nil {
		return Session{}, err
	}
	return session, nil
}

func Save(path string, session Session) error {
	session.UpdatedAt = time.Now()
	data, err := json.MarshalIndent(session, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0644)
}

func Clear(path string) error {
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

func (s *Session) AddContext(kind, source, content string) {
	s.Context = append(s.Context, ContextItem{
		Kind:      kind,
		Source:    source,
		Content:   content,
		CreatedAt: time.Now(),
	})
}

func (s *Session) AddMessages(messages ...openai.Message) {
	s.Messages = append(s.Messages, messages...)
}

func (s *Session) Trim(maxMessages, maxContextItems int) {
	if maxMessages > 0 && len(s.Messages) > maxMessages {
		s.Messages = s.Messages[len(s.Messages)-maxMessages:]
	}
	if maxContextItems > 0 && len(s.Context) > maxContextItems {
		s.Context = s.Context[len(s.Context)-maxContextItems:]
	}
}

func (s Session) ContextParts() []string {
	out := make([]string, 0, len(s.Context))
	for _, item := range s.Context {
		out = append(out, item.Kind+": "+item.Source+"\n"+item.Content)
	}
	return out
}
