'use strict';

const DEFAULT_BASE_URL = 'http://127.0.0.1:8000/v1/chat/completions';
const DEFAULT_MODEL = 'local-model';

function resolveModel(settings, requestedName) {
  const cfg = settings || {};
  const models = cfg.models || {};
  const name = requestedName || cfg.activeModel || '';
  const profile = name && models[name] ? models[name] : null;
  const mergedHeaders = Object.assign({}, cfg.headers || {});
  if (profile && profile.headers) {
    Object.assign(mergedHeaders, profile.headers);
  }
  const resolved = {
    profileName: profile ? name : 'default',
    baseUrl: (profile && profile.baseUrl) || cfg.baseUrl || DEFAULT_BASE_URL,
    model: (profile && profile.model) || cfg.model || DEFAULT_MODEL,
    apiKey: (profile && profile.apiKey) || cfg.apiKey || '',
    stream: cfg.stream === true,
    headers: mergedHeaders
  };
  if (profile && Object.prototype.hasOwnProperty.call(profile, 'stream')) {
    resolved.stream = profile.stream === true;
  }
  return resolved;
}

function hasCommandPrefix(command, prefix) {
  const cmd = String(command || '').trim().toLowerCase();
  const pfx = String(prefix || '').trim().toLowerCase();
  if (!cmd || !pfx) {
    return false;
  }
  return cmd === pfx || cmd.indexOf(pfx + ' ') === 0 || cmd.indexOf(pfx + '.') === 0;
}

function validateCommand(command, policy) {
  const cfg = policy || {};
  const cmd = String(command || '').trim();
  if (!cmd) {
    return { ok: false, reason: 'empty command' };
  }
  if (cfg.enabled === false) {
    return { ok: false, reason: 'command execution is disabled' };
  }
  const blocked = cfg.blockedPrefixes || [];
  for (let i = 0; i < blocked.length; i += 1) {
    if (hasCommandPrefix(cmd, blocked[i])) {
      return { ok: false, reason: 'command prefix "' + String(blocked[i]).trim() + '" is blocked' };
    }
  }
  return { ok: true, reason: '' };
}

function requiresConfirmation(command, policy) {
  const cfg = policy || {};
  if (cfg.alwaysConfirm === true) {
    return true;
  }
  const prefixes = cfg.confirmPrefixes || [];
  for (let i = 0; i < prefixes.length; i += 1) {
    if (hasCommandPrefix(command, prefixes[i])) {
      return true;
    }
  }
  return false;
}

function parseSkillMarkdown(markdown, fallbackName) {
  const text = String(markdown || '');
  let meta = {};
  let body = text;
  if (text.indexOf('---') === 0) {
    const end = text.indexOf('\n---', 3);
    if (end >= 0) {
      meta = parseFrontMatter(text.slice(3, end));
      body = text.slice(end + 4);
    }
  }
  const name = meta.name || fallbackName || 'skill';
  return {
    name: name,
    description: meta.description || '',
    keywords: splitKeywords(meta.keywords || ''),
    prompt: body.trim()
  };
}

function parseFrontMatter(text) {
  const meta = {};
  String(text || '').split(/\r?\n/).forEach((line) => {
    const idx = line.indexOf(':');
    if (idx < 0) {
      return;
    }
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) {
      meta[key] = stripQuotes(value);
    }
  });
  return meta;
}

function stripQuotes(value) {
  const s = String(value || '').trim();
  if ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === '\'' && s[s.length - 1] === '\'')) {
    return s.slice(1, -1);
  }
  return s;
}

function splitKeywords(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  return String(value || '')
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function selectSkills(skills, query, explicitNames) {
  const all = Array.isArray(skills) ? skills : [];
  const explicit = Array.isArray(explicitNames) ? explicitNames.filter(Boolean) : [];
  if (explicit.length > 0) {
    const byName = {};
    all.forEach((skill) => {
      byName[String(skill.name || '').toLowerCase()] = skill;
    });
    return explicit.map((name) => byName[String(name).toLowerCase()]).filter(Boolean);
  }
  const q = String(query || '').toLowerCase();
  const scored = [];
  all.forEach((skill, index) => {
    const haystack = [
      skill.name || '',
      skill.description || '',
      (skill.keywords || []).join(' ')
    ].join(' ').toLowerCase();
    let score = 0;
    if (skill.name && q.indexOf(String(skill.name).toLowerCase()) >= 0) {
      score += 3;
    }
    (skill.keywords || []).forEach((keyword) => {
      if (keyword && q.indexOf(String(keyword).toLowerCase()) >= 0) {
        score += 2;
      }
    });
    if (haystack && q.indexOf(haystack) >= 0) {
      score += 1;
    }
    if (score > 0) {
      scored.push({ skill: skill, score: score, index: index });
    }
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, 3).map((item) => item.skill);
}

function extractHtml(html, baseUrl) {
  const raw = String(html || '');
  const withoutScripts = raw
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  const title = cleanText(matchFirst(withoutScripts, /<title\b[^>]*>([\s\S]*?)<\/title>/i));
  const description = extractDescription(withoutScripts);
  const main = extractMain(withoutScripts);
  const textSource = main
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside\b[^>]*>[\s\S]*?<\/aside>/gi, '')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '');
  const links = extractLinks(textSource, baseUrl);
  return {
    url: baseUrl || '',
    title: title,
    description: description,
    text: htmlToText(textSource),
    links: links
  };
}

function extractDescription(html) {
  const metaRe = /<meta\b[^>]*>/gi;
  let match;
  while ((match = metaRe.exec(html)) !== null) {
    const tag = match[0];
    const name = attr(tag, 'name') || attr(tag, 'property');
    if (!name || !/^(description|og:description)$/i.test(name)) {
      continue;
    }
    const content = attr(tag, 'content');
    if (content) {
      return cleanText(content);
    }
  }
  return '';
}

function extractMain(html) {
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html);
  if (main) {
    return main[1];
  }
  const article = /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html);
  if (article) {
    return article[1];
  }
  return html;
}

function extractLinks(html, baseUrl) {
  const links = [];
  const linkRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = linkRe.exec(html)) !== null && links.length < 200) {
    const href = attr(match[1], 'href');
    if (!href) {
      continue;
    }
    links.push({
      text: cleanText(match[2]),
      href: resolveUrl(baseUrl, decodeEntities(href))
    });
  }
  return links;
}

function attr(tag, name) {
  const re = new RegExp('\\b' + escapeRegExp(name) + '\\s*=\\s*("([^"]*)"|\\\'([^\\\']*)\\\'|([^\\s>]+))', 'i');
  const match = re.exec(tag);
  if (!match) {
    return '';
  }
  return decodeEntities(match[2] || match[3] || match[4] || '');
}

function htmlToText(html) {
  let s = String(html || '');
  s = s.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, (table) => '\n' + tableToText(table) + '\n');
  s = s.replace(/<\/(h1|h2|h3|p|tr|li)>/gi, '\n\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  return cleanText(s);
}

function tableToText(table) {
  const rows = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRe.exec(table)) !== null) {
    const values = [];
    const cellRe = /<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
      values.push(cleanText(cellMatch[1].replace(/<[^>]+>/g, ' ')));
    }
    if (values.length > 0) {
      rows.push(values.join(' | '));
    }
  }
  return rows.join('\n');
}

function cleanText(value) {
  return decodeEntities(String(value || '').replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/ *\n+ */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeEntities(value) {
  const entities = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: '\'',
    nbsp: ' '
  };
  return String(value || '').replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (full, name) => {
    if (name[0] === '#') {
      const isHex = name[1] && name[1].toLowerCase() === 'x';
      const code = parseInt(isHex ? name.slice(2) : name.slice(1), isHex ? 16 : 10);
      if (!Number.isNaN(code)) {
        return String.fromCharCode(code);
      }
      return full;
    }
    return Object.prototype.hasOwnProperty.call(entities, name) ? entities[name] : full;
  });
}

function resolveUrl(baseUrl, href) {
  if (!baseUrl) {
    return href;
  }
  try {
    return new URL(href, baseUrl).toString();
  } catch (err) {
    return href;
  }
}

function matchFirst(text, regex) {
  const match = regex.exec(text);
  return match ? match[1] : '';
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function trimMemory(memory, maxMessages, maxContextItems) {
  const source = memory || {};
  const messages = Array.isArray(source.messages) ? source.messages.slice() : [];
  const context = Array.isArray(source.context) ? source.context.slice() : [];
  return {
    messages: maxMessages > 0 ? messages.slice(-maxMessages) : messages,
    context: maxContextItems > 0 ? context.slice(-maxContextItems) : context
  };
}

function contextToParts(context) {
  return (Array.isArray(context) ? context : []).map((item) => {
    return String(item.kind || 'context') + ': ' + String(item.source || '') + '\n' + String(item.content || '');
  });
}

function buildSystemPrompt(skillPrompt, contextParts) {
  const lines = [
    'You are Win7 Agent for VS Code, an assistant running in an offline corporate intranet.',
    'Use only the provided context, local files, intranet URLs, and configured OpenAI-compatible API.',
    'Ordinary local commands are allowed; high-risk command prefixes require user confirmation.',
    'Do not ask to bypass corporate security controls.'
  ];
  if (skillPrompt) {
    lines.push('', skillPrompt);
  }
  const parts = Array.isArray(contextParts) ? contextParts.filter(Boolean) : [];
  if (parts.length > 0) {
    lines.push('', 'Local context:');
    parts.forEach((part) => {
      lines.push('', '---', part);
    });
  }
  return lines.join('\n');
}

function buildDraftPrompt(kind, topic, tone) {
  const type = String(kind || 'notice').toLowerCase();
  const topicText = String(topic || '').trim();
  const toneText = String(tone || '正式、清晰、适合公司内部沟通').trim();
  const templates = {
    meeting: '请撰写一份会议纪要，包含会议背景、讨论要点、结论、风险、行动项、负责人和截止时间。',
    email: '请撰写一封公司内部邮件，包含主题、收件人建议、正文、下一步动作和礼貌收尾。',
    notice: '请撰写一份公司内部通知，包含目的、适用范围、具体安排、注意事项和联系人。',
    report: '请撰写一份工作报告，包含背景、进展、数据/事实、问题风险、下一步计划。',
    summary: '请撰写一份摘要，包含核心结论、关键依据、影响范围和待确认事项。',
    proposal: '请撰写一份方案建议，包含目标、现状、方案、实施步骤、资源需求、风险和验收标准。'
  };
  const instruction = templates[type] || templates.notice;
  return [
    instruction,
    '',
    '主题：' + topicText,
    '语气：' + toneText,
    '',
    '请直接输出可交付正文，不要解释你将如何写。'
  ].join('\n');
}

function buildChatMessages(settings, memory, skills, userText, explicitSkills) {
  const selected = selectSkills(skills, userText, explicitSkills);
  const skillPrompt = selected.map((skill) => skill.prompt).join('\n\n');
  const trimmed = trimMemory(memory, settings.maxMemoryMessages || 40, settings.maxContextItems || 12);
  const system = buildSystemPrompt(skillPrompt, contextToParts(trimmed.context));
  return [{ role: 'system', content: system }]
    .concat(trimmed.messages || [])
    .concat([{ role: 'user', content: String(userText || '') }]);
}

module.exports = {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  resolveModel,
  hasCommandPrefix,
  validateCommand,
  requiresConfirmation,
  parseSkillMarkdown,
  selectSkills,
  extractHtml,
  trimMemory,
  contextToParts,
  buildSystemPrompt,
  buildDraftPrompt,
  buildChatMessages
};
