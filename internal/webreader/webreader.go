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
	URL         string
	Title       string
	Description string
	Text        string
	Links       []Link
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
	body := decodeHTML(data)
	page := Page{URL: rawURL, Title: extractTitle(body), Description: extractDescription(body), Links: extractLinks(body)}
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
	if page.Description != "" {
		b.WriteString("> ")
		b.WriteString(page.Description)
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
	noiseRE  = regexp.MustCompile(`(?is)<nav\b[^>]*>.*?</nav>|<footer\b[^>]*>.*?</footer>|<aside\b[^>]*>.*?</aside>|<noscript\b[^>]*>.*?</noscript>`)
	mainRE   = regexp.MustCompile(`(?is)<main\b[^>]*>(.*?)</main>|<article\b[^>]*>(.*?)</article>`)
	tableRE  = regexp.MustCompile(`(?is)<table\b[^>]*>(.*?)</table>`)
	rowRE    = regexp.MustCompile(`(?is)<tr\b[^>]*>(.*?)</tr>`)
	cellRE   = regexp.MustCompile(`(?is)<t[hd]\b[^>]*>(.*?)</t[hd]>`)
	tagRE    = regexp.MustCompile(`(?is)<[^>]+>`)
	spaceRE  = regexp.MustCompile(`[ \t\r\f\v]+`)
	blankRE  = regexp.MustCompile(`\n{3,}`)
	titleRE  = regexp.MustCompile(`(?is)<title\b[^>]*>(.*?)</title>`)
	descRE   = regexp.MustCompile(`(?is)<meta\b[^>]*(name|property)=["']?(description|og:description)["']?[^>]*content=["']([^"']+)["'][^>]*>`)
	linkRE   = regexp.MustCompile(`(?is)<a\b[^>]*href=["']?([^"'\s>]+)["']?[^>]*>(.*?)</a>`)
)

func extractTitle(s string) string {
	m := titleRE.FindStringSubmatch(s)
	if len(m) < 2 {
		return ""
	}
	return cleanText(m[1])
}

func extractDescription(s string) string {
	m := descRE.FindStringSubmatch(s)
	if len(m) < 4 {
		return ""
	}
	return cleanText(m[3])
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
	s = noiseRE.ReplaceAllString(s, "")
	if main := mainRE.FindStringSubmatch(s); len(main) >= 3 {
		if main[1] != "" {
			s = main[1]
		} else {
			s = main[2]
		}
	}
	s = tableRE.ReplaceAllStringFunc(s, tableToText)
	replacements := []string{
		"</h1>", "</h1>\n\n",
		"</h2>", "</h2>\n\n",
		"</h3>", "</h3>\n\n",
		"</p>", "</p>\n\n",
		"<br>", "<br>\n",
		"<br/>", "<br/>\n",
		"</tr>", "</tr>\n",
		"</li>", "</li>\n",
	}
	replacer := strings.NewReplacer(replacements...)
	s = replacer.Replace(s)
	s = tagRE.ReplaceAllString(s, " ")
	return cleanText(s)
}

func tableToText(table string) string {
	rows := rowRE.FindAllStringSubmatch(table, -1)
	var lines []string
	for _, row := range rows {
		if len(row) < 2 {
			continue
		}
		cells := cellRE.FindAllStringSubmatch(row[1], -1)
		var values []string
		for _, cell := range cells {
			if len(cell) >= 2 {
				values = append(values, cleanText(tagRE.ReplaceAllString(cell[1], " ")))
			}
		}
		if len(values) > 0 {
			lines = append(lines, strings.Join(values, " | "))
		}
	}
	if len(lines) == 0 {
		return ""
	}
	return "\n" + strings.Join(lines, "\n") + "\n"
}

func decodeHTML(data []byte) string {
	if bytesHasUTF8BOM(data) {
		return string(data[3:])
	}
	return string(data)
}

func bytesHasUTF8BOM(data []byte) bool {
	return len(data) >= 3 && data[0] == 0xef && data[1] == 0xbb && data[2] == 0xbf
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
