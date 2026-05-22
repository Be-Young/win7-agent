package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"win7-agent/internal/config"
	"win7-agent/internal/docs"
	"win7-agent/internal/doctemplate"
	"win7-agent/internal/memory"
	"win7-agent/internal/openai"
	"win7-agent/internal/safety"
	"win7-agent/internal/skills"
	"win7-agent/internal/webreader"
)

type runtimeEnv struct {
	baseDir    string
	configPath string
	cfg        config.Config
	active     config.Config
	client     *openai.Client
	skills     []skills.Skill
}

type agentAction struct {
	Action  string `json:"action"`
	Command string `json:"command"`
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) == 0 {
		args = []string{"chat"}
	}
	env, err := loadEnv()
	if err != nil {
		return err
	}
	switch args[0] {
	case "chat":
		return chat(env)
	case "doc":
		return docCommand(env, args[1:])
	case "web":
		return webCommand(env, args[1:])
	case "model":
		return modelCommand(env, args[1:])
	case "memory":
		return memoryCommand(env, args[1:])
	case "auth":
		return authCommand(env, args[1:])
	case "skills":
		for _, s := range env.skills {
			fmt.Printf("%s\t%s\n", s.Name, s.Description)
		}
		return nil
	case "version":
		fmt.Println("win7-agent 0.3.0")
		return nil
	case "help", "-h", "--help":
		usage()
		return nil
	default:
		return fmt.Errorf("unknown command %q", args[0])
	}
}

func loadEnv() (runtimeEnv, error) {
	base := baseDir()
	configPath := config.DefaultConfigPath(base)
	cfg, err := config.Load(configPath)
	if err != nil {
		return runtimeEnv{}, err
	}
	active := cfg.ResolveModel("")
	client := newClient(base, active)
	loadedSkills, _ := skills.LoadDir(filepath.Join(base, "skills"))
	return runtimeEnv{baseDir: base, configPath: configPath, cfg: cfg, active: active, client: client, skills: loadedSkills}, nil
}

func newClient(base string, cfg config.Config) *openai.Client {
	return openai.New(openai.Config{
		BaseURL:            cfg.BaseURL,
		Model:              cfg.Model,
		APIKey:             cfg.APIKey,
		Stream:             cfg.Stream,
		TimeoutSeconds:     cfg.TimeoutSeconds,
		CAFile:             absMaybe(base, cfg.CAFile),
		InsecureSkipVerify: cfg.InsecureSkipVerify,
		Headers:            cfg.Headers,
	})
}

func baseDir() string {
	cwd, _ := os.Getwd()
	if _, err := os.Stat(filepath.Join(cwd, "config")); err == nil {
		return cwd
	}
	exe, err := os.Executable()
	if err != nil {
		return cwd
	}
	return filepath.Dir(exe)
}

func chat(env runtimeEnv) error {
	printBanner(env)
	reader := bufio.NewReader(os.Stdin)
	session := memory.Session{}
	if env.cfg.Memory.Enabled {
		loaded, err := memory.Load(memoryPath(env))
		if err != nil {
			fmt.Println("memory warning:", err)
		} else {
			session = loaded
		}
	}
	conversation := append([]openai.Message{}, session.Messages...)
	contextParts := session.ContextParts()
	for {
		fmt.Printf("[%s]> ", env.active.Model)
		line, err := reader.ReadString('\n')
		if err != nil {
			if errors.Is(err, os.ErrClosed) {
				return nil
			}
			return nil
		}
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		switch {
		case line == "/quit" || line == "/exit":
			_ = saveSession(env, session)
			return nil
		case line == "/help":
			chatHelp()
			continue
		case line == "/status":
			printStatus(env, session)
			continue
		case line == "/memory":
			printMemory(session)
			continue
		case line == "/clear":
			session = memory.Session{}
			conversation = nil
			contextParts = nil
			if err := memory.Clear(memoryPath(env)); err != nil {
				fmt.Println("memory clear error:", err)
			} else {
				fmt.Println("memory cleared")
			}
			continue
		case line == "/model":
			printModels(env)
			continue
		case strings.HasPrefix(line, "/model "):
			name := strings.TrimSpace(strings.TrimPrefix(line, "/model "))
			if err := switchModel(&env, name); err != nil {
				fmt.Println("model error:", err)
			}
			continue
		case line == "/skills":
			for _, s := range env.skills {
				fmt.Printf("%s\t%s\n", s.Name, s.Description)
			}
			continue
		case strings.HasPrefix(line, "/file "):
			path := strings.TrimSpace(strings.TrimPrefix(line, "/file "))
			text, err := docs.Read(path, env.cfg.MaxContentChars)
			if err != nil {
				fmt.Println("file error:", err)
				continue
			}
			session.AddContext("file", path, text)
			session.Trim(env.cfg.Memory.MaxMessages, env.cfg.Memory.MaxContextItems)
			contextParts = session.ContextParts()
			_ = saveSession(env, session)
			fmt.Println("loaded file:", path)
			continue
		case strings.HasPrefix(line, "/url "):
			raw := strings.TrimSpace(strings.TrimPrefix(line, "/url "))
			page, err := readURL(env, raw)
			if err != nil {
				fmt.Println("url error:", err)
				continue
			}
			session.AddContext("url", raw, webreader.Markdown(page))
			session.Trim(env.cfg.Memory.MaxMessages, env.cfg.Memory.MaxContextItems)
			contextParts = session.ContextParts()
			_ = saveSession(env, session)
			fmt.Println("loaded url:", raw)
			continue
		case strings.HasPrefix(line, "/run "):
			command := strings.TrimSpace(strings.TrimPrefix(line, "/run "))
			if err := runCommand(env, reader, command); err != nil {
				fmt.Println("command error:", err)
			}
			continue
		}
		selected := skills.Select(env.skills, line)
		system := systemPrompt(skills.Prompt(selected), contextParts)
		messages := append([]openai.Message{{Role: "system", Content: system}}, conversation...)
		messages = append(messages, openai.Message{Role: "user", Content: line})
		answer, err := send(env, messages)
		if err != nil {
			fmt.Println("api error:", err)
			continue
		}
		session.AddMessages(openai.Message{Role: "user", Content: line}, openai.Message{Role: "assistant", Content: answer})
		session.Trim(env.cfg.Memory.MaxMessages, env.cfg.Memory.MaxContextItems)
		conversation = append([]openai.Message{}, session.Messages...)
		_ = saveSession(env, session)
		if action, ok := extractAction(answer); ok && action.Action == "run_command" {
			fmt.Println("\nModel requested command:", action.Command)
			if err := runCommand(env, reader, action.Command); err != nil {
				fmt.Println("command error:", err)
			}
		}
	}
}

func docCommand(env runtimeEnv, args []string) error {
	if len(args) == 0 {
		return errors.New("doc command required: read, ask, rewrite, create")
	}
	switch args[0] {
	case "read":
		if len(args) < 2 {
			return errors.New("usage: agent doc read <path>")
		}
		text, err := docs.Read(args[1], env.cfg.MaxContentChars)
		if err != nil {
			return err
		}
		fmt.Println(text)
		return nil
	case "ask":
		if len(args) < 3 {
			return errors.New(`usage: agent doc ask <path> "<question>"`)
		}
		text, err := docs.Read(args[1], env.cfg.MaxContentChars)
		if err != nil {
			return err
		}
		answer, err := env.client.Chat(context.Background(), []openai.Message{
			{Role: "system", Content: systemPrompt("", []string{"File: " + args[1] + "\n" + text})},
			{Role: "user", Content: strings.Join(args[2:], " ")},
		})
		if err != nil {
			return err
		}
		fmt.Println(answer)
		return nil
	case "rewrite":
		rewriteArgs := args[1:]
		out := option(rewriteArgs, "out", "")
		instruction := option(rewriteArgs, "instruction", "rewrite clearly")
		positional := positionalArgs(rewriteArgs)
		if len(positional) < 1 || out == "" {
			return errors.New(`usage: agent doc rewrite <input> --out <output> --instruction "<要求>"`)
		}
		input := positional[0]
		text, err := docs.Read(input, env.cfg.MaxContentChars)
		if err != nil {
			return err
		}
		prompt := "Rewrite the document according to this instruction:\n" + instruction + "\n\nDocument:\n" + text
		answer, err := env.client.Chat(context.Background(), []openai.Message{{Role: "user", Content: prompt}})
		if err != nil {
			return err
		}
		if err := docs.WriteContent(out, answer); err != nil {
			return err
		}
		fmt.Println("wrote:", out)
		return nil
	case "create":
		createArgs := args[1:]
		format := option(createArgs, "format", "md")
		out := option(createArgs, "out", "")
		prompt := option(createArgs, "prompt", "")
		if out == "" || prompt == "" {
			return errors.New(`usage: agent doc create --format txt|md|csv|docx|xlsx --out <path> --prompt "<要求>"`)
		}
		answer, err := env.client.Chat(context.Background(), []openai.Message{{Role: "user", Content: "Create a " + format + " document:\n" + prompt}})
		if err != nil {
			return err
		}
		if err := docs.WriteContent(out, answer); err != nil {
			return err
		}
		fmt.Println("wrote:", out)
		return nil
	case "draft":
		draftArgs := args[1:]
		kind := option(draftArgs, "type", "notice")
		out := option(draftArgs, "out", "")
		topic := option(draftArgs, "topic", "")
		tone := option(draftArgs, "tone", "正式、清晰、适合公司内部沟通")
		if topic == "" {
			positional := positionalArgs(draftArgs)
			if len(positional) > 0 {
				topic = strings.Join(positional, " ")
			}
		}
		if out == "" || topic == "" {
			return errors.New(`usage: agent doc draft --type meeting|email|notice|report|summary|proposal --out <path> --topic "<主题>"`)
		}
		prompt, err := doctemplate.BuildDraftPrompt(kind, topic, tone)
		if err != nil {
			return err
		}
		answer, err := env.client.Chat(context.Background(), []openai.Message{{Role: "user", Content: prompt}})
		if err != nil {
			return err
		}
		if err := docs.WriteContent(out, answer); err != nil {
			return err
		}
		fmt.Println("wrote:", out)
		return nil
	default:
		return fmt.Errorf("unknown doc command %q", args[0])
	}
}

func modelCommand(env runtimeEnv, args []string) error {
	if len(args) == 0 || args[0] == "current" {
		fmt.Printf("active model: %s (%s)\n", env.active.Model, env.active.BaseURL)
		if env.cfg.ActiveModel != "" {
			fmt.Println("profile:", env.cfg.ActiveModel)
		}
		return nil
	}
	switch args[0] {
	case "list":
		printModels(env)
		return nil
	case "use":
		if len(args) < 2 {
			return errors.New("usage: agent model use <name>")
		}
		return switchModel(&env, args[1])
	default:
		return fmt.Errorf("unknown model command %q", args[0])
	}
}

func memoryCommand(env runtimeEnv, args []string) error {
	session, err := memory.Load(memoryPath(env))
	if err != nil {
		return err
	}
	if len(args) == 0 || args[0] == "show" {
		printMemory(session)
		return nil
	}
	switch args[0] {
	case "clear":
		if err := memory.Clear(memoryPath(env)); err != nil {
			return err
		}
		fmt.Println("memory cleared")
		return nil
	default:
		return fmt.Errorf("unknown memory command %q", args[0])
	}
}

func webCommand(env runtimeEnv, args []string) error {
	if len(args) < 2 {
		return errors.New("usage: agent web read|ask|save <url>")
	}
	switch args[0] {
	case "read":
		page, err := readURL(env, args[1])
		if err != nil {
			return err
		}
		fmt.Println(webreader.Markdown(page))
		return nil
	case "ask":
		if len(args) < 3 {
			return errors.New(`usage: agent web ask <url> "<question>"`)
		}
		page, err := readURL(env, args[1])
		if err != nil {
			return err
		}
		answer, err := env.client.Chat(context.Background(), []openai.Message{
			{Role: "system", Content: systemPrompt("", []string{webreader.Markdown(page)})},
			{Role: "user", Content: strings.Join(args[2:], " ")},
		})
		if err != nil {
			return err
		}
		fmt.Println(answer)
		return nil
	case "save":
		saveArgs := args[1:]
		out := option(saveArgs, "out", "")
		positional := positionalArgs(saveArgs)
		if len(positional) < 1 || out == "" {
			return errors.New("usage: agent web save <url> --out <path.md>")
		}
		page, err := readURL(env, positional[0])
		if err != nil {
			return err
		}
		if err := docs.WriteNew(out, []byte(webreader.Markdown(page))); err != nil {
			return err
		}
		fmt.Println("wrote:", out)
		return nil
	default:
		return fmt.Errorf("unknown web command %q", args[0])
	}
}

func authCommand(env runtimeEnv, args []string) error {
	if len(args) < 1 || args[0] != "set" {
		return errors.New(`usage: agent auth set <name> --match <url-substring> --header "Cookie: a=b"`)
	}
	authArgs := args[1:]
	match := option(authArgs, "match", "")
	header := option(authArgs, "header", "")
	cookie := option(authArgs, "cookie", "")
	user := option(authArgs, "user", "")
	pass := option(authArgs, "pass", "")
	positional := positionalArgs(authArgs)
	if len(positional) < 1 || match == "" {
		return errors.New(`usage: agent auth set <name> --match <url-substring> --header "Cookie: a=b"`)
	}
	name := positional[0]
	if env.cfg.AuthProfiles == nil {
		env.cfg.AuthProfiles = map[string]config.AuthProfile{}
	}
	profile := config.AuthProfile{Match: match, Headers: map[string]string{}, Cookie: cookie, BasicUsername: user, BasicPassword: pass}
	if header != "" {
		k, v, ok := strings.Cut(header, ":")
		if !ok {
			return errors.New("header must be Name: value")
		}
		profile.Headers[strings.TrimSpace(k)] = strings.TrimSpace(v)
	}
	env.cfg.AuthProfiles[name] = profile
	path := config.DefaultConfigPath(env.baseDir)
	if err := config.Save(path, env.cfg); err != nil {
		return err
	}
	fmt.Println("saved auth profile:", name)
	return nil
}

func readURL(env runtimeEnv, raw string) (webreader.Page, error) {
	opts := webreader.Options{
		Headers:            map[string]string{},
		Timeout:            time.Duration(env.cfg.TimeoutSeconds) * time.Second,
		MaxBytes:           int64(env.cfg.MaxContentChars * 4),
		CAFile:             absMaybe(env.baseDir, env.cfg.CAFile),
		InsecureSkipVerify: env.cfg.InsecureSkipVerify,
	}
	for k, v := range env.cfg.Headers {
		opts.Headers[k] = v
	}
	for _, profile := range env.cfg.AuthProfiles {
		if profile.Match == "" || strings.Contains(raw, profile.Match) {
			for k, v := range profile.Headers {
				opts.Headers[k] = v
			}
			if profile.Cookie != "" {
				opts.Cookie = profile.Cookie
			}
			if profile.BasicUsername != "" || profile.BasicPassword != "" {
				opts.BasicUsername = profile.BasicUsername
				opts.BasicPassword = profile.BasicPassword
			}
		}
	}
	page, err := webreader.Read(raw, opts)
	if err != nil {
		return page, err
	}
	for i := range page.Links {
		page.Links[i].Href = webreader.ResolveURL(raw, page.Links[i].Href)
	}
	return page, nil
}

func send(env runtimeEnv, messages []openai.Message) (string, error) {
	if env.active.Stream {
		answer, err := env.client.ChatStream(context.Background(), messages, func(delta string) {
			fmt.Print(delta)
		})
		fmt.Println()
		return answer, err
	}
	answer, err := env.client.Chat(context.Background(), messages)
	if err != nil {
		return "", err
	}
	fmt.Println(answer)
	return answer, nil
}

func runCommand(env runtimeEnv, reader *bufio.Reader, command string) error {
	policy := safety.CommandPolicy{
		Enabled:         env.cfg.Command.Enabled,
		ConfirmPrefixes: env.cfg.Command.ConfirmPrefixes,
		BlockedPrefixes: env.cfg.Command.BlockedPrefixes,
		AuditLog:        absMaybe(env.baseDir, env.cfg.Command.AuditLog),
		MaxOutputBytes:  env.cfg.Command.MaxOutputBytes,
	}
	if err := policy.Validate(command); err != nil {
		return err
	}
	if env.cfg.Command.AlwaysConfirm || policy.RequiresConfirmation(command) {
		fmt.Printf("High-risk command, confirm run? %s [y/N]: ", command)
		line, _ := reader.ReadString('\n')
		if strings.ToLower(strings.TrimSpace(line)) != "y" {
			return errors.New("command cancelled")
		}
	}
	out, err := policy.Run(context.Background(), command)
	if out != "" {
		fmt.Println(out)
	}
	return err
}

func extractAction(text string) (agentAction, bool) {
	start := strings.Index(text, "```agent-action")
	if start >= 0 {
		rest := text[start+len("```agent-action"):]
		end := strings.Index(rest, "```")
		if end >= 0 {
			var action agentAction
			if err := json.Unmarshal([]byte(strings.TrimSpace(rest[:end])), &action); err == nil {
				return action, true
			}
		}
	}
	var action agentAction
	if err := json.Unmarshal([]byte(strings.TrimSpace(text)), &action); err == nil && action.Action != "" {
		return action, true
	}
	return agentAction{}, false
}

func systemPrompt(skillPrompt string, contextParts []string) string {
	var b strings.Builder
	b.WriteString("You are Win7 Agent CLI, an assistant running in an offline corporate intranet. ")
	b.WriteString("Use only the provided context, local files, intranet URLs, and configured OpenAI-compatible API. ")
	b.WriteString("If you need a local command, request it in a fenced block exactly like: ```agent-action\n{\"action\":\"run_command\",\"command\":\"dir\"}\n```. ")
	b.WriteString("Ordinary local commands are allowed; high-risk command prefixes require user confirmation. ")
	b.WriteString("Do not ask to bypass corporate security controls.\n")
	if skillPrompt != "" {
		b.WriteByte('\n')
		b.WriteString(skillPrompt)
	}
	if len(contextParts) > 0 {
		b.WriteString("\n\nLocal context:\n")
		for _, part := range contextParts {
			b.WriteString("\n---\n")
			b.WriteString(part)
			b.WriteByte('\n')
		}
	}
	return b.String()
}

func absMaybe(base, path string) string {
	if path == "" || filepath.IsAbs(path) {
		return path
	}
	if runtime.GOOS == "windows" && len(path) > 1 && path[1] == ':' {
		return path
	}
	return filepath.Join(base, path)
}

func usage() {
	fmt.Println(`Win7 Agent CLI

Usage:
  agent chat
  agent skills
  agent doc read <path>
  agent doc ask <path> "<question>"
  agent doc rewrite <input> --out <output> --instruction "<要求>"
  agent doc create --format txt|md|csv|docx|xlsx --out <path> --prompt "<要求>"
  agent doc draft --type meeting|email|notice|report|summary|proposal --out <path> --topic "<主题>"
  agent web read <url>
  agent web ask <url> "<question>"
  agent web save <url> --out <path.md>
  agent model list
  agent model use <name>
  agent memory show
  agent memory clear
  agent auth set <name> --match <url-substring> --header "Cookie: a=b"
  agent version`)
}

func chatHelp() {
	fmt.Println(`Chat commands:
  /file <path>   load txt/md/csv/json/log/docx/xlsx as context
  /url <url>     load an intranet page as context
  /run <command> run a local command; high-risk prefixes ask confirmation
  /model         list model profiles
  /model <name>  switch model profile and save config
  /status        show active model, memory, and context status
  /memory        show remembered conversation/context counts
  /clear         clear persistent conversation memory
  /skills        list local SKILL.md files
  /quit          exit`)
}

func printBanner(env runtimeEnv) {
	fmt.Println("Win7 Agent CLI v0.3.0")
	fmt.Printf("Model: %s", env.active.Model)
	if env.cfg.ActiveModel != "" {
		fmt.Printf(" profile=%s", env.cfg.ActiveModel)
	}
	fmt.Println()
	fmt.Println("Type /help for commands, /status for context, /quit to exit.")
}

func printStatus(env runtimeEnv, session memory.Session) {
	fmt.Printf("model: %s\n", env.active.Model)
	fmt.Printf("api: %s\n", env.active.BaseURL)
	fmt.Printf("memory: %t, messages=%d, context=%d\n", env.cfg.Memory.Enabled, len(session.Messages), len(session.Context))
	fmt.Printf("commands: enabled=%t, high-risk-confirm-prefixes=%d\n", env.cfg.Command.Enabled, len(env.cfg.Command.ConfirmPrefixes))
}

func printMemory(session memory.Session) {
	fmt.Printf("remembered messages: %d\n", len(session.Messages))
	fmt.Printf("remembered context items: %d\n", len(session.Context))
	for _, item := range session.Context {
		fmt.Printf("- %s: %s\n", item.Kind, item.Source)
	}
}

func printModels(env runtimeEnv) {
	if len(env.cfg.Models) == 0 {
		fmt.Printf("default: %s (%s)\n", env.cfg.Model, env.cfg.BaseURL)
		return
	}
	for name, profile := range env.cfg.Models {
		marker := " "
		if name == env.cfg.ActiveModel {
			marker = "*"
		}
		modelName := profile.Model
		if modelName == "" {
			modelName = env.cfg.Model
		}
		baseURL := profile.BaseURL
		if baseURL == "" {
			baseURL = env.cfg.BaseURL
		}
		fmt.Printf("%s %s: %s (%s)\n", marker, name, modelName, baseURL)
	}
}

func switchModel(env *runtimeEnv, name string) error {
	if name == "" || name == "default" {
		env.cfg.ActiveModel = ""
	} else if _, ok := env.cfg.Models[name]; !ok {
		return fmt.Errorf("unknown model profile %q", name)
	} else {
		env.cfg.ActiveModel = name
	}
	if err := config.Save(env.configPath, env.cfg); err != nil {
		return err
	}
	env.active = env.cfg.ResolveModel("")
	env.client = newClient(env.baseDir, env.active)
	fmt.Printf("switched model: %s\n", env.active.Model)
	return nil
}

func memoryPath(env runtimeEnv) string {
	return absMaybe(env.baseDir, env.cfg.Memory.SessionFile)
}

func saveSession(env runtimeEnv, session memory.Session) error {
	if !env.cfg.Memory.Enabled {
		return nil
	}
	session.Trim(env.cfg.Memory.MaxMessages, env.cfg.Memory.MaxContextItems)
	return memory.Save(memoryPath(env), session)
}

func option(args []string, name, fallback string) string {
	prefix := "--" + name + "="
	for i := 0; i < len(args); i++ {
		if args[i] == "--"+name && i+1 < len(args) {
			return args[i+1]
		}
		if strings.HasPrefix(args[i], prefix) {
			return strings.TrimPrefix(args[i], prefix)
		}
	}
	return fallback
}

func positionalArgs(args []string) []string {
	var out []string
	for i := 0; i < len(args); i++ {
		if strings.HasPrefix(args[i], "--") {
			if !strings.Contains(args[i], "=") && i+1 < len(args) {
				i++
			}
			continue
		}
		out = append(out, args[i])
	}
	return out
}
