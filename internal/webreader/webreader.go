package webreader

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"
)

type Options struct {
	Headers            map[string]string
	Cookie             string
	BasicUsername      string
	BasicPassword      string
	Timeout            time.Duration
	MaxBytes           int64
	CAFile             string
	InsecureSkipVerify bool
}

type Page struct {
	URL   string
	Title string
	Text  string
	Links []Link
}

type Link struct {
	Text string
	Href string
}

func Read(rawURL string, opts Options) (Page, error) {
	if opts.Timeout == 0 {
		opts.Timeout = 60 * time.Second
	}
	if opts.MaxBytes == 0 {
		opts.MaxBytes = 5 << 20
	}
	req, err := http.NewRequest(http.MethodGet, rawURL, nil)
	if err != nil {
		return Page{}, err
	}
	req.Header.Set("User-Agent", "win7-agent/0.1")
	for k, v := range opts.Headers {
		req.Header.Set(k, v)
	}
	if opts.Cookie != "" {
		req.Header.Set("Cookie", opts.Cookie)
	}
	if opts.BasicUsername != "" || opts.BasicPassword != "" {
		req.SetBasicAuth(opts.BasicUsername, opts.BasicPassword)
	}
	client := &http.Client{Timeout: opts.Timeout, Transport: transport(opts)}
	resp, err := client.Do(req)
	if err != nil {
		return Page{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return Page{}, fmt.Errorf("web status %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, opts.MaxBytes))
	if err != nil {
		return Page{}, err
	}
	body := string(data)
	page := Page{URL: rawURL, Title: extractTitle(body), Links: extractLinks(body)}
	page.Text = htmlToText(body)
	return page, nil
}

func Markdown(page Page) string {
	var b strings.Builder
	if page.Title != "" {
		b.WriteString("# ")
		b.WriteString(page.Title)
		b.WriteString("\n\n")
	}
	b.WriteString("Source: ")
	b.WriteString(page.URL)
	b.WriteString("\n\n")
	b.WriteString(page.Text)
	if len(page.Links) > 0 {
		b.WriteString("\n\n## Links\n")
		for _, link := range page.Links {
			b.WriteString("- ")
			if link.Text != "" {
				b.WriteString(link.Text)
				b.WriteString(": ")
			}
			b.WriteString(link.Href)
			b.WriteByte('\n')
		}
	}
	return b.String()
}

func ResolveURL(baseURL, href string) string {
	base, err := url.Parse(baseURL)
	if err != nil {
		return href
	}
	u, err := url.Parse(href)
	if err != nil {
		return href
	}
	return base.ResolveReference(u).String()
}

var (
	scriptRE = regexp.MustCompile(`(?is)<script\b[^>]*>.*?</script>`)
	styleRE  = regexp.MustCompile(`(?is)<style\b[^>]*>.*?</style>`)
	tagRE    = regexp.MustCompile(`(?is)<[^>]+>`)
	spaceRE  = regexp.MustCompile(`[ \t\r\f\v]+`)
	blankRE  = regexp.MustCompile(`\n{3,}`)
	titleRE  = regexp.MustCompile(`(?is)<title\b[^>]*>(.*?)</title>`)
	linkRE   = regexp.MustCompile(`(?is)<a\b[^>]*href=["']?([^"'\s>]+)["']?[^>]*>(.*?)</a>`)
)

func extractTitle(s string) string {
	m := titleRE.FindStringSubmatch(s)
	if len(m) < 2 {
		return ""
	}
	return cleanText(m[1])
}

func extractLinks(s string) []Link {
	matches := linkRE.FindAllStringSubmatch(s, 200)
	out := make([]Link, 0, len(matches))
	for _, m := range matches {
		if len(m) >= 3 {
			out = append(out, Link{Href: html.UnescapeString(strings.TrimSpace(m[1])), Text: cleanText(m[2])})
		}
	}
	return out
}

func htmlToText(s string) string {
	s = scriptRE.ReplaceAllString(s, "")
	s = styleRE.ReplaceAllString(s, "")
	s = strings.ReplaceAll(s, "</p>", "</p>\n")
	s = strings.ReplaceAll(s, "<br>", "<br>\n")
	s = strings.ReplaceAll(s, "<br/>", "<br/>\n")
	s = strings.ReplaceAll(s, "</tr>", "</tr>\n")
	s = strings.ReplaceAll(s, "</li>", "</li>\n")
	s = tagRE.ReplaceAllString(s, " ")
	return cleanText(s)
}

func cleanText(s string) string {
	s = html.UnescapeString(s)
	lines := strings.Split(s, "\n")
	for i, line := range lines {
		lines[i] = strings.TrimSpace(spaceRE.ReplaceAllString(line, " "))
	}
	return strings.TrimSpace(blankRE.ReplaceAllString(strings.Join(lines, "\n"), "\n\n"))
}

func transport(opts Options) http.RoundTripper {
	t := http.DefaultTransport.(*http.Transport).Clone()
	if opts.CAFile == "" && !opts.InsecureSkipVerify {
		return t
	}
	tlsCfg := &tls.Config{InsecureSkipVerify: opts.InsecureSkipVerify} //nolint:gosec
	if opts.CAFile != "" {
		pem, err := os.ReadFile(opts.CAFile)
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
