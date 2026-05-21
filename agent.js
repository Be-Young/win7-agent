// Win7 Agent CLI script-lite edition.
// Runs with cscript.exe on Windows 7. Uses only built-in ActiveX components.

var fso = new ActiveXObject("Scripting.FileSystemObject");
var baseDir = fso.GetParentFolderName(WScript.ScriptFullName);

function main() {
  var args = collectArgs();
  var cfg = loadConfig();
  if (args.length === 0) {
    args = ["chat"];
  }
  var cmd = args[0].toLowerCase();
  if (cmd === "chat") {
    chat(cfg);
  } else if (cmd === "ask") {
    if (args.length < 2) fail('usage: agent.cmd ask "prompt"');
    print(chatOnce(cfg, "", joinFrom(args, 1)));
  } else if (cmd === "file") {
    if (args.length < 3) fail('usage: agent.cmd file <path> "question"');
    var text = readText(args[1]);
    print(chatOnce(cfg, "File: " + args[1] + "\n" + text, joinFrom(args, 2)));
  } else if (cmd === "url") {
    if (args.length < 3) fail('usage: agent.cmd url <url> "question"');
    var page = readURL(cfg, args[1]);
    print(chatOnce(cfg, page, joinFrom(args, 2)));
  } else if (cmd === "skills") {
    listSkills();
  } else if (cmd === "help" || cmd === "-h" || cmd === "--help") {
    usage();
  } else {
    fail("unknown command: " + args[0]);
  }
}

function collectArgs() {
  var out = [];
  for (var i = 0; i < WScript.Arguments.length; i++) {
    out.push(WScript.Arguments.Item(i));
  }
  return out;
}

function loadConfig() {
  var path = fso.BuildPath(baseDir, "config\\agent.json");
  if (!fso.FileExists(path)) {
    path = fso.BuildPath(baseDir, "config\\agent.example.json");
  }
  var cfg = {
    base_url: "http://127.0.0.1:8000/v1/chat/completions",
    model: "local-model",
    api_key: "",
    timeout_seconds: 120,
    max_content_chars: 120000,
    headers: {},
    auth_profiles: {}
  };
  if (fso.FileExists(path)) {
    var loaded = parseJson(readText(path));
    for (var k in loaded) {
      cfg[k] = loaded[k];
    }
  }
  if (!cfg.headers) cfg.headers = {};
  if (!cfg.auth_profiles) cfg.auth_profiles = {};
  return cfg;
}

function chat(cfg) {
  print("Win7 Agent Script Lite. Type /help for commands, /quit to exit.");
  var context = "";
  while (true) {
    WScript.StdOut.Write("> ");
    var line = "";
    try {
      line = WScript.StdIn.ReadLine();
    } catch (e) {
      return;
    }
    line = trim(line);
    if (line === "") continue;
    if (line === "/quit" || line === "/exit") return;
    if (line === "/help") {
      print("/file <path> loads txt/md/csv/json/log as context");
      print("/url <url> loads a simple intranet page as context");
      print("/skills lists local SKILL.md files");
      print("/quit exits");
      continue;
    }
    if (line === "/skills") {
      listSkills();
      continue;
    }
    if (startsWith(line, "/file ")) {
      var filePath = trim(line.substring(6));
      context += "\n\nFile: " + filePath + "\n" + readText(filePath);
      print("loaded file: " + filePath);
      continue;
    }
    if (startsWith(line, "/url ")) {
      var rawURL = trim(line.substring(5));
      context += "\n\n" + readURL(cfg, rawURL);
      print("loaded url: " + rawURL);
      continue;
    }
    print(chatOnce(cfg, context, line));
  }
}

function chatOnce(cfg, context, userPrompt) {
  var skillPrompt = selectSkillPrompt(userPrompt);
  var system = "You are Win7 Agent Script Lite running in an offline corporate intranet. " +
    "Use provided local context and configured OpenAI-compatible API. " +
    "This script edition cannot execute local commands or edit Office files.";
  if (skillPrompt !== "") system += "\n\n" + skillPrompt;
  if (context !== "") system += "\n\nLocal context:\n" + context;
  var body = {
    model: cfg.model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userPrompt }
    ]
  };
  var response = postJson(cfg, cfg.base_url, stringify(body));
  if (!response.choices || response.choices.length === 0) {
    fail("chat API returned no choices");
  }
  return response.choices[0].message.content;
}

function postJson(cfg, url, body) {
  var http = createHttp();
  http.open("POST", url, false);
  http.setRequestHeader("Content-Type", "application/json");
  if (cfg.api_key && cfg.api_key !== "") {
    http.setRequestHeader("Authorization", "Bearer " + cfg.api_key);
  }
  for (var k in cfg.headers) {
    http.setRequestHeader(k, cfg.headers[k]);
  }
  http.send(body);
  if (http.status < 200 || http.status >= 300) {
    fail("chat API status " + http.status + ": " + http.responseText);
  }
  return parseJson(http.responseText);
}

function readURL(cfg, rawURL) {
  var http = createHttp();
  http.open("GET", rawURL, false);
  http.setRequestHeader("User-Agent", "win7-agent-script-lite/0.1");
  for (var k in cfg.headers) {
    http.setRequestHeader(k, cfg.headers[k]);
  }
  for (var name in cfg.auth_profiles) {
    var profile = cfg.auth_profiles[name];
    if (!profile.match || rawURL.indexOf(profile.match) >= 0) {
      if (profile.headers) {
        for (var hk in profile.headers) {
          http.setRequestHeader(hk, profile.headers[hk]);
        }
      }
      if (profile.cookie) {
        http.setRequestHeader("Cookie", profile.cookie);
      }
    }
  }
  http.send();
  if (http.status < 200 || http.status >= 300) {
    fail("web status " + http.status + ": " + http.responseText);
  }
  return htmlToText(http.responseText);
}

function createHttp() {
  try {
    return new ActiveXObject("MSXML2.ServerXMLHTTP.6.0");
  } catch (e) {
    return new ActiveXObject("MSXML2.ServerXMLHTTP.3.0");
  }
}

function readText(path) {
  var stream = new ActiveXObject("ADODB.Stream");
  stream.Type = 2;
  stream.Charset = "utf-8";
  stream.Open();
  stream.LoadFromFile(path);
  var text = stream.ReadText();
  stream.Close();
  return text;
}

function listSkills() {
  var list = loadSkills();
  for (var i = 0; i < list.length; i++) {
    print(list[i].name + "\t" + list[i].description);
  }
}

function selectSkillPrompt(prompt) {
  var list = loadSkills();
  var lower = prompt.toLowerCase();
  var out = "";
  for (var i = 0; i < list.length; i++) {
    var s = list[i];
    if (lower.indexOf("@skill:" + s.name.toLowerCase()) >= 0 || lower.indexOf(s.name.toLowerCase()) >= 0) {
      out += "\n--- skill: " + s.name + " ---\n" + s.content + "\n";
    }
  }
  return out;
}

function loadSkills() {
  var root = fso.BuildPath(baseDir, "skills");
  var out = [];
  if (!fso.FolderExists(root)) return out;
  walkSkills(fso.GetFolder(root), out);
  return out;
}

function walkSkills(folder, out) {
  var file = fso.BuildPath(folder.Path, "SKILL.md");
  if (fso.FileExists(file)) {
    var content = readText(file);
    out.push(parseSkill(file, content));
  }
  var folders = new Enumerator(folder.SubFolders);
  for (; !folders.atEnd(); folders.moveNext()) {
    walkSkills(folders.item(), out);
  }
}

function parseSkill(path, content) {
  var folder = fso.GetParentFolderName(path);
  var name = fso.GetFileName(folder);
  var description = "";
  var lines = content.split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var line = trim(lines[i]);
    if (startsWith(line, "name:")) name = trim(line.substring(5)).replace(/['"]/g, "");
    if (startsWith(line, "description:")) description = trim(line.substring(12)).replace(/['"]/g, "");
  }
  return { name: name, description: description, content: content };
}

function htmlToText(html) {
  var s = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  s = s.replace(/<\/p>|<br\s*\/?>|<\/tr>|<\/li>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = s.replace(/&nbsp;/g, " ");
  s = s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
  s = s.replace(/[ \t\r\f\v]+/g, " ");
  s = s.replace(/\n\s+/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return trim(s);
}

function stringify(value) {
  if (value === null) return "null";
  var t = typeof value;
  if (t === "string") return quote(value);
  if (t === "number" || t === "boolean") return String(value);
  if (value instanceof Array) {
    var a = [];
    for (var i = 0; i < value.length; i++) a.push(stringify(value[i]));
    return "[" + a.join(",") + "]";
  }
  var parts = [];
  for (var k in value) {
    parts.push(quote(k) + ":" + stringify(value[k]));
  }
  return "{" + parts.join(",") + "}";
}

function quote(s) {
  return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t") + '"';
}

function parseJson(text) {
  return eval("(" + text + ")");
}

function joinFrom(args, start) {
  var out = [];
  for (var i = start; i < args.length; i++) out.push(args[i]);
  return out.join(" ");
}

function startsWith(s, prefix) {
  return s.substring(0, prefix.length) === prefix;
}

function trim(s) {
  return String(s).replace(/^\s+|\s+$/g, "");
}

function print(s) {
  WScript.StdOut.WriteLine(s);
}

function fail(s) {
  WScript.StdErr.WriteLine("error: " + s);
  WScript.Quit(1);
}

function usage() {
  print("Win7 Agent Script Lite");
  print("Usage:");
  print('  agent.cmd chat');
  print('  agent.cmd ask "prompt"');
  print('  agent.cmd file <path> "question"');
  print('  agent.cmd url <url> "question"');
  print('  agent.cmd skills');
}

main();
