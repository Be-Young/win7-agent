# Win7 Agent 中文操作手册

本文面向在 Windows 7 办公电脑上使用 `Win7 Agent` 的用户。当前版本包含 EXE 正式版和 VS Code 插件版，用于连接公司内网 OpenAI 兼容接口，并提供聊天、文档处理、网页读取、办公 skills、本地记忆、模型切换和受控命令执行能力。

## 1. EXE 版安装

1. 获取 `agent-win7-x64.zip`。
2. 解压到普通用户可写目录，例如：

```bat
D:\tools\agent-win7-x64
```

3. 进入解压目录，复制配置模板：

```bat
copy config\agent.example.json config\agent.json
```

4. 编辑 `config\agent.json`，至少填写：

```json
{
  "base_url": "http://你的内网地址/v1/chat/completions",
  "model": "你的模型名称",
  "api_key": ""
}
```

5. 启动：

```bat
agent.exe chat
```

## 1.1 VS Code 插件版安装

Windows 7 只能使用 VS Code 1.70.x，建议固定安装 VS Code 1.70.3。

1. 获取 `win7-agent-vscode-0.3.0.vsix`。
2. 打开 VS Code。
3. 进入扩展面板，点击右上角 `...`。
4. 选择 `Install from VSIX...`，选中 `.vsix` 文件。
5. 安装后重启 VS Code。

也可以使用命令行：

```bat
code --install-extension win7-agent-vscode-0.3.0.vsix
```

在 VS Code 设置 JSON 中填写：

```json
{
  "win7Agent.baseUrl": "http://你的内网地址/v1/chat/completions",
  "win7Agent.model": "你的模型名称",
  "win7Agent.apiKey": ""
}
```

打开聊天：

```text
Win7 Agent: Open Chat
```

VS Code 插件版支持聊天、模型切换、skills、记忆、文本文件、网页读取、命令执行和办公文档起草；对于 `docx/xlsx`，插件会调用随 VSIX 打包的 `agent.exe` 完成完整读写。

## 2. 配置说明

配置文件路径：

```text
config\agent.json
```

常用字段：

| 字段 | 说明 |
| --- | --- |
| `base_url` | 内网 OpenAI 兼容接口地址，通常以 `/v1/chat/completions` 结尾 |
| `model` | 默认模型名称 |
| `active_model` | 当前启用的模型配置名，留空表示使用默认模型 |
| `models` | 多模型配置，用于 `agent.exe model use <name>` 或聊天内 `/model <name>` |
| `api_key` | API Key；如果内网网关不需要鉴权，可以留空 |
| `stream` | 是否启用流式输出 |
| `headers` | 调用模型接口时附加的全局 Header |
| `auth_profiles` | 内网页面的 Cookie/Header/Basic Auth 配置 |
| `command.enabled` | 是否允许本地命令执行，默认开启 |
| `command.confirm_prefixes` | 高危命令前缀，命中后需要人工确认 |
| `command.blocked_prefixes` | 永远拒绝执行的命令前缀，默认空 |
| `memory.enabled` | 是否启用本地会话记忆 |
| `memory.session_file` | 记忆保存文件 |
| `max_content_chars` | 文档和网页送入模型前的最大字符数 |

Bearer Token 示例：

```json
"api_key": "你的 token"
```

额外 Header 示例：

```json
"headers": {
  "X-Department": "office"
}
```

## 3. 多模型切换

在 `config\agent.json` 中配置模型：

```json
"models": {
  "fast": {
    "base_url": "http://llm.internal/v1/chat/completions",
    "model": "fast-model",
    "api_key": "",
    "stream": true,
    "headers": {}
  },
  "deep": {
    "base_url": "http://llm.internal/v1/chat/completions",
    "model": "deep-model",
    "api_key": "",
    "stream": true,
    "headers": {}
  }
}
```

命令行切换：

```bat
agent.exe model list
agent.exe model current
agent.exe model use fast
```

聊天中切换：

```text
> /model
> /model deep
```

切换后会写回 `config\agent.json` 的 `active_model`。

## 4. 交互聊天

启动：

```bat
agent.exe chat
```

常用交互命令：

| 命令 | 说明 |
| --- | --- |
| `/help` | 查看交互命令 |
| `/status` | 查看当前模型、记忆和上下文状态 |
| `/model` | 查看可用模型 |
| `/model <name>` | 切换模型 |
| `/skills` | 列出本地 skills |
| `/file <路径>` | 加载本地文件作为上下文 |
| `/url <地址>` | 加载内网页面作为上下文 |
| `/run <命令>` | 执行本地命令；高危命令需确认 |
| `/memory` | 查看当前记忆数量 |
| `/clear` | 清空本地会话记忆 |
| `/quit` | 退出 |

示例：

```text
> /file report.docx
> 总结这份报告的结论和风险
> /url http://intranet/notice
> 提取这页公告里的时间节点
```

## 5. 上下文记忆

程序默认启用本地记忆，保存最近的对话和加载过的文件/网页上下文。

默认路径：

```text
sessions\default.json
```

查看记忆：

```bat
agent.exe memory show
```

清空记忆：

```bat
agent.exe memory clear
```

聊天中也可以用：

```text
> /memory
> /clear
```

安全提醒：

- 记忆文件可能包含文档摘要、网页内容和对话内容。
- 如果处理敏感材料，请在会话结束后执行 `/clear`。
- 不要把 `sessions\` 目录发给无关人员。

## 6. Skills 办公场景

skills 位于：

```text
skills\
```

当前内置办公 skills：

| Skill | 场景 |
| --- | --- |
| `general` | 通用离线办公助手 |
| `email` | 邮件起草、回复、润色、催办 |
| `meeting` | 会议通知、会议纪要、议程、行动项 |
| `report` | 周报、月报、项目进展、风险汇报 |
| `spreadsheet` | 表格字段设计、数据检查、CSV/XLSX 整理 |
| `web-summary` | 内网页面、制度、公告、知识库总结 |
| `translator` | 中英文办公翻译和双语润色 |

查看 skills：

```bat
agent.exe skills
```

显式使用某个 skill：

```text
> @skill:email 帮我写一封催供应商反馈报价的邮件
> @skill:meeting 根据刚才的讨论整理会议纪要
```

v1/v0.2 只兼容 Markdown 指令包，不执行 MCP、Node、Python 插件。

## 7. 文档处理和撰写

支持读取：

```text
txt, md, csv, json, log, docx, xlsx
```

读取文档：

```bat
agent.exe doc read report.docx
agent.exe doc read table.xlsx
```

围绕文档问答：

```bat
agent.exe doc ask report.docx "总结这份文档的主要内容"
agent.exe doc ask table.xlsx "找出异常项和缺失值"
```

改写文档，只写新文件，不覆盖原文件：

```bat
agent.exe doc rewrite report.docx --out report.rewrite.docx --instruction "改写得更正式，保留原意"
```

生成文档：

```bat
agent.exe doc create --format md --out notice.md --prompt "写一份部门会议通知"
agent.exe doc create --format docx --out notice.docx --prompt "写一份正式会议通知"
agent.exe doc create --format xlsx --out table.xlsx --prompt "生成三列表格：姓名、部门、备注"
```

按办公模板起草：

```bat
agent.exe doc draft --type meeting --out meeting.md --topic "下周项目例会"
agent.exe doc draft --type email --out mail.md --topic "催供应商反馈报价" --tone "礼貌但明确"
agent.exe doc draft --type report --out weekly.docx --topic "本周项目进展"
agent.exe doc draft --type proposal --out plan.md --topic "内网 Agent 试点方案"
```

可用模板类型：

```text
meeting, email, notice, report, summary, proposal
```

说明：

- `docx/xlsx` 以基础内容正确和 Office 可打开为目标。
- 不承诺保留复杂版式、图片、宏、批注、公式和扫描件。
- 默认拒绝覆盖已有文件，避免误改办公资料。

## 8. 网页读取

读取内网页面：

```bat
agent.exe web read http://intranet/
agent.exe web ask http://intranet/ "这页主要讲什么"
agent.exe web save http://intranet/ --out intranet.md
```

聊天中加载：

```text
> /url http://intranet/notice
> 总结刚才加载的公告
```

当前网页读取能力：

- 提取标题和 meta description。
- 尽量优先提取 `main` 或 `article` 正文。
- 自动忽略常见 `nav/footer/aside/noscript` 噪声。
- 表格会转成更容易阅读的文本行。
- 链接会解析为完整 URL。

限制：

- 不执行 JavaScript。
- 不渲染浏览器页面。
- 需要登录态的页面要配置 Cookie/Header。
- 如果页面正文完全由脚本动态加载，建议找静态接口或手动导出文本。

## 9. 内网登录页面配置

示例：

```json
"auth_profiles": {
  "portal": {
    "match": "portal.internal",
    "headers": {
      "Cookie": "SESSION=替换成你的 Cookie"
    },
    "cookie": "",
    "basic_username": "",
    "basic_password": ""
  }
}
```

也可以用命令保存：

```bat
agent.exe auth set portal --match portal.internal --header "Cookie: SESSION=替换成你的 Cookie"
```

注意：

- 不要把包含真实 Cookie、Token 的 `config\agent.json` 发给别人。
- 项目默认 `.gitignore` 已排除 `config/agent.json`。

## 10. 本地命令执行

命令执行默认开启。普通命令直接执行，高危命令需要人工确认。

默认高危确认前缀包括：

```text
del, erase, format, reg, net, netsh, powershell, wmic, shutdown, sc, takeown, icacls, diskpart, cipher
```

示例配置：

```json
"command": {
  "enabled": true,
  "confirm_prefixes": ["del", "reg", "powershell", "shutdown"],
  "blocked_prefixes": [],
  "always_confirm": false,
  "audit_log": "logs/commands.log",
  "max_output_bytes": 65536
}
```

执行命令：

```text
> /run dir
> /run findstr /s /i "error" *.log
```

如果命中高危前缀：

```text
High-risk command, confirm run? del temp.txt [y/N]:
```

建议：

- 不熟悉的命令不要确认。
- 可以把公司明确禁止的命令加入 `blocked_prefixes`。
- 命令审计日志默认写入 `logs\commands.log`。

## 11. 邮件和内网分发建议

如果 EXE 已可进入内网，建议采用：

1. IT 审查 `agent-source-vendor.zip` 或 GitHub 仓库源码。
2. IT 放行 `agent-win7-x64.zip`。
3. 通过内网共享盘、软件分发系统或邮件发送正式包。

不建议：

- 改后缀伪装 EXE。
- 使用加密压缩包绕过安全策略。
- 把真实 API Key 或 Cookie 一起发邮件。

## 12. 常见问题

### 无法连接模型接口

检查：

- `base_url` 是否正确，是否包含 `/v1/chat/completions`。
- 办公电脑是否能访问该内网地址。
- API 是否需要 `api_key` 或额外 Header。
- 当前 `/model` 是否切到了错误 profile。

### 返回 401 或 403

检查：

- `api_key` 是否正确。
- Header 名称和值是否正确。
- 内网页面是否需要 Cookie 或 Basic Auth。

### 中文乱码

EXE 版内部使用 UTF-8。如果控制台仍然乱码，可以先执行：

```bat
chcp 65001
agent.exe chat
```

### 网页读取不到正文

可能原因：

- 页面由 JavaScript 动态加载。
- 没有登录态 Cookie。
- 页面禁止非浏览器客户端访问。

建议：

- 配置 Cookie/Header。
- 使用静态接口或导出页面。
- 手动保存为文本后用 `/file` 加载。

### 不想保留记忆

临时清空：

```text
> /clear
```

永久关闭：

```json
"memory": {
  "enabled": false
}
```

## 13. 升级和回退

升级：

1. 备份旧目录中的 `config\agent.json`、`skills\` 和需要保留的 `sessions\`。
2. 解压新版本。
3. 复制旧配置和自定义 skills。
4. 运行：

```bat
agent.exe version
agent.exe chat
```

回退：

1. 保留旧版本目录。
2. 如果新版本异常，直接切回旧目录运行。
3. 不需要卸载系统组件。

## 14. 首次试用检查清单

1. 已复制 `config\agent.example.json` 为 `config\agent.json`。
2. 已填写 `base_url` 和 `model`。
3. 如需鉴权，已填写 `api_key` 或 Header。
4. `agent.exe chat` 能启动。
5. 输入简单问题能收到模型回复。
6. `/model` 能看到模型列表。
7. `/file notes.md` 能加载本地文本。
8. `/url http://intranet/` 能读取内网页面。
9. `/run dir` 能执行普通命令。
10. 高危命令会要求确认。
