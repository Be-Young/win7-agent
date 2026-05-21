package openai

import (
	"bufio"
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

type Config struct {
	BaseURL            string
	Model              string
	APIKey             string
	Stream             bool
	TimeoutSeconds     int
	CAFile             string
	InsecureSkipVerify bool
	Headers            map[string]string
}

type Client struct {
	cfg  Config
	http *http.Client
}

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatRequest struct {
	Model       string    `json:"model"`
	Messages    []Message `json:"messages"`
	Stream      bool      `json:"stream,omitempty"`
	Temperature float64   `json:"temperature,omitempty"`
}

type chatResponse struct {
	Choices []struct {
		Message struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Error *apiError `json:"error,omitempty"`
}

type streamResponse struct {
	Choices []struct {
		Delta struct {
			Content string `json:"content"`
		} `json:"delta"`
	} `json:"choices"`
	Error *apiError `json:"error,omitempty"`
}

type apiError struct {
	Message string `json:"message"`
	Type    string `json:"type"`
}

func New(cfg Config) *Client {
	timeout := time.Duration(cfg.TimeoutSeconds) * time.Second
	if timeout == 0 {
		timeout = 120 * time.Second
	}
	return &Client{cfg: cfg, http: &http.Client{Timeout: timeout, Transport: transport(cfg)}}
}

func (c *Client) Chat(ctx context.Context, messages []Message) (string, error) {
	body, err := json.Marshal(chatRequest{Model: c.cfg.Model, Messages: messages, Stream: false})
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.cfg.BaseURL, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	c.addHeaders(req)
	resp, err := c.http.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("chat API status %d: %s", resp.StatusCode, strings.TrimSpace(string(data)))
	}
	var decoded chatResponse
	if err := json.Unmarshal(data, &decoded); err != nil {
		return "", err
	}
	if decoded.Error != nil {
		return "", errors.New(decoded.Error.Message)
	}
	if len(decoded.Choices) == 0 {
		return "", errors.New("chat API returned no choices")
	}
	return decoded.Choices[0].Message.Content, nil
}

func (c *Client) ChatStream(ctx context.Context, messages []Message, onDelta func(string)) (string, error) {
	body, err := json.Marshal(chatRequest{Model: c.cfg.Model, Messages: messages, Stream: true})
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.cfg.BaseURL, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	c.addHeaders(req)
	resp, err := c.http.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		data, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("chat API status %d: %s", resp.StatusCode, strings.TrimSpace(string(data)))
	}
	var full strings.Builder
	scanner := bufio.NewScanner(resp.Body)
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, ":") {
			continue
		}
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if payload == "[DONE]" {
			break
		}
		var decoded streamResponse
		if err := json.Unmarshal([]byte(payload), &decoded); err != nil {
			return full.String(), err
		}
		if decoded.Error != nil {
			return full.String(), errors.New(decoded.Error.Message)
		}
		if len(decoded.Choices) == 0 {
			continue
		}
		delta := decoded.Choices[0].Delta.Content
		if delta != "" {
			full.WriteString(delta)
			onDelta(delta)
		}
	}
	if err := scanner.Err(); err != nil {
		return full.String(), err
	}
	return full.String(), nil
}

func (c *Client) addHeaders(req *http.Request) {
	req.Header.Set("Content-Type", "application/json")
	if c.cfg.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.cfg.APIKey)
	}
	for k, v := range c.cfg.Headers {
		req.Header.Set(k, v)
	}
}

func transport(cfg Config) http.RoundTripper {
	t := http.DefaultTransport.(*http.Transport).Clone()
	if cfg.CAFile == "" && !cfg.InsecureSkipVerify {
		return t
	}
	tlsCfg := &tls.Config{InsecureSkipVerify: cfg.InsecureSkipVerify} //nolint:gosec
	if cfg.CAFile != "" {
		pem, err := os.ReadFile(cfg.CAFile)
		if err == nil {
			pool, err := x509.SystemCertPool()
			if err != nil || pool == nil {
				pool = x509.NewCertPool()
			}
			if pool.AppendCertsFromPEM(pem) {
				tlsCfg.RootCAs = pool
			}
		}
	}
	t.TLSClientConfig = tlsCfg
	return t
}
