# Win7 Agent CLI 中文操作手册

本文面向在 Windows 7 办公电脑上试用 `Win7 Agent CLI` 的用户。工具用于连接公司内网 OpenAI 兼容接口，提供聊天、文档处理、网页读取、`SKILL.md` 指令包和受控命令执行能力。

## 版本说明

项目提供两个试用版本：

- **EXE 正式版**：文件包为 `agent-win7-x64.zip`，包含 `agent.exe`。适合 IT 放行、内网共享盘分发或软件分发系统安装。
- **脚本轻量版**：文件包为 `agent-script-lite.zip`，不包含 `.exe`，通过 Win7 自带的 `cscript.exe` 运行。适合邮件附件先行测试。

能力差异：

| 能力 | EXE 正式版 | 脚本轻量版 |
| --- | --- | --- |
| Chat Completions 聊天 | 支持 | 支持 |
| 流式输出 | 支持，可配置 | 不支持 |
| `SKILL.md` 指令包 | 支持 | 支持 |
| `txt/md/csv/json/log` 读取 | 支持 | 支持 |
| `docx/xlsx` 读取和生成 | 支持基础内容 | 不支持 |
| 静态内网页面读取 | 支持 | 支持简单页面 |
| Cookie/Header 登录态页面 | 支持 | 支持基础 Header/Cookie |
| 本地命令执行 | 支持白名单和确认 | 不支持 |

## 安装

### EXE 正式版

1. 解压 `agent-win7-x64.zip` 到普通用户可写目录，例如：

```bat
D:\tools\agent-win7-x64
```

2. 进入解压目录。

3. 复制配置模板：

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

### 脚本轻量版

1. 解压 `agent-script-lite.zip`。

2. 复制配置模板：

```bat
copy config\agent.example.json config\agent.json
```

3. 编辑 `config\agent.json`。

4. 启动：

```bat
agent.cmd chat
```

脚本版依赖 Win7 自带的 `cmd.exe`、`cscript.exe`、`MSXML2.ServerXMLHTTP` 和 `ADODB.Stream`，不需要安装 Go、Python、Node 或新版 .NET。

## 配置说明

配置文件路径：

```text
config\agent.json
```

常用字段：

| 字段 | 说明 |
| --- | --- |
| `base_url` | 内网 OpenAI 兼容接口地址，通常以 `/v1/chat/completions` 结尾 |
| `model` | 模型名称 |
| `api_key` | API Key；如果内网网关不需要鉴权，可以留空 |
| `stream` | EXE 版是否启用流式输出 |
| `timeout_seconds` | 请求超时时间 |
| `headers` | 全局请求 Header |
| `auth_profiles` | 针对内网页面的 Cookie/Header/Basic Auth 配置 |
| `command.enabled` | EXE 版是否允许本地命令执行 |
| `command.allowed_prefixes` | 允许执行的命令前缀 |
| `command.always_confirm` | 执行命令前是否必须确认 |
| `max_content_chars` | 文档和网页送入模型前的最大字符数 |

如果接口需要 Bearer Token：

```json
"api_key": "你的 token"
```

程序会自动发送：

```text
Authorization: Bearer 你的 token
```

如果内网网关要求额外 Header：

```json
"headers": {
  "X-Department": "office"
}
```

## 基础聊天

启动交互模式：

```bat
agent.exe chat
```

或脚本版：

```bat
agent.cmd chat
```

进入后可以直接输入问题：

```text
> 帮我写一段会议通知
```

常用交互命令：

| 命令 | 说明 |
| --- | --- |
| `/help` | 查看交互命令 |
| `/skills` | 列出本地 skills |
| `/file <路径>` | 加载本地文件作为上下文 |
| `/url <地址>` | 加载内网页面作为上下文 |
| `/run <命令>` | EXE 版执行白名单命令 |
| `/quit` | 退出 |

## 文档处理

EXE 版支持基础文档读取、问答、生成和改写新文件。

### 读取文档

```bat
agent.exe doc read report.docx
agent.exe doc read table.xlsx
agent.exe doc read notes.md
```

支持输入格式：

```text
txt, md, csv, json, log, docx, xlsx
```

### 围绕文档问答

```bat
agent.exe doc ask report.docx "总结这份文档的主要内容"
agent.exe doc ask table.xlsx "找出表格里的异常项"
```

### 改写文档

改写不会覆盖原文件，只会写入新文件：

```bat
agent.exe doc rewrite report.docx --out report.rewrite.docx --instruction "改写得更正式，保留原意"
```

### 生成新文档

```bat
agent.exe doc create --format md --out notice.md --prompt "写一份部门会议通知"
agent.exe doc create --format docx --out notice.docx --prompt "写一份正式会议通知"
agent.exe doc create --format xlsx --out table.xlsx --prompt "生成三列表格：姓名、部门、备注"
```

注意：

- `docx/xlsx` 能力以基础内容正确为目标，不承诺保留复杂版式、图片、宏、批注和公式。
- 程序默认拒绝覆盖已有文件，避免误改办公资料。
- 脚本轻量版不支持 `docx/xlsx`。

## 网页读取

EXE 版支持读取办公电脑可访问的内网页面：

```bat
agent.exe web read http://intranet/
agent.exe web ask http://intranet/ "这页主要讲什么"
agent.exe web save http://intranet/ --out intranet.md
```

交互模式中也可以加载网页：

```text
> /url http://intranet/
> 总结刚才加载的网页
```

脚本轻量版：

```bat
agent.cmd url http://intranet/ "总结这个网页"
```

限制：

- 只读取办公电脑网络可达的网页。
- 不执行 JavaScript，不渲染动态页面。
- 如果正文必须登录后由浏览器脚本加载，建议先找静态接口、导出页面或使用 Cookie/Header 配置。

## 内网登录页面配置

如果内网页面需要 Cookie 或自定义 Header，可以写入 `auth_profiles`。

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

也可以使用 EXE 命令保存：

```bat
agent.exe auth set portal --match portal.internal --header "Cookie: SESSION=替换成你的 Cookie"
```

安全建议：

- 不要把包含真实 Cookie 或 Token 的 `config\agent.json` 发给别人。
- 不要把 `config\agent.json` 提交到 Git 仓库。
- 项目默认 `.gitignore` 已排除 `config/agent.json`。

## Skills 使用

skills 放在：

```text
skills\
```

每个 skill 使用一个目录，并包含 `SKILL.md`：

```text
skills\general\SKILL.md
skills\writer\SKILL.md
```

查看本地 skills：

```bat
agent.exe skills
agent.cmd skills
```

在聊天中显式使用某个 skill：

```text
> @skill:general 帮我写一份邮件回复
```

`SKILL.md` 示例：

```markdown
---
name: writer
description: 帮助起草和润色办公文字
---

# Writer

- 使用简洁、正式的中文。
- 保留事实，不编造数据。
- 输出前检查语气是否适合公司内部沟通。
```

v1 只兼容 Markdown 指令包，不执行 MCP、Node、Python 插件。

## 本地命令执行

只有 EXE 版支持命令执行，并且默认关闭。

启用方式：

```json
"command": {
  "enabled": true,
  "allowed_prefixes": [
    "dir",
    "type",
    "findstr",
    "where",
    "ver",
    "echo"
  ],
  "always_confirm": true,
  "audit_log": "logs/commands.log",
  "max_output_bytes": 65536
}
```

手动执行：

```text
> /run dir
```

模型也可以请求执行命令，但程序会先检查白名单，并要求用户确认。

默认阻止的高风险命令包括：

```text
del, erase, format, reg, net, netsh, powershell, wmic, shutdown, sc, takeown, icacls, diskpart, cipher
```

建议：

- 先只保留只读命令。
- 不要把删除、注册表、网络配置、服务管理命令加入白名单。
- 保留 `always_confirm: true`。

## 邮件传输建议

如果公司邮箱拦截 `.exe`：

1. 优先发送 `agent-script-lite.zip` 做连通性测试。
2. 将 `agent-source-vendor.zip` 交给 IT 审查或内网构建机。
3. EXE 正式版通过 IT 放行、内网共享盘或软件分发系统传入。

不建议：

- 改后缀伪装 EXE。
- 使用加密压缩包绕过安全策略。
- 把真实 API Key 或 Cookie 一起发邮件。

## 常见问题

### 提示无法连接模型接口

检查：

- `base_url` 是否正确，是否包含 `/v1/chat/completions`。
- 办公电脑是否能访问该内网地址。
- API 是否需要 `api_key` 或额外 Header。
- 代理、防火墙或网关是否拦截。

### 返回 401 或 403

检查：

- `api_key` 是否正确。
- Header 名称和值是否正确。
- 内网页面是否需要 Cookie 或 Basic Auth。

### 中文显示乱码

EXE 版内部使用 UTF-8，并尽量兼容 Windows 控制台。脚本版启动时会执行：

```bat
chcp 65001
```

如果仍然乱码，可以尝试：

```bat
chcp 65001
agent.cmd chat
```

### `docx/xlsx` 内容不完整

当前版本只提取基础文本、表格和单元格内容，不处理复杂版式、宏、图片、批注、公式和扫描件。

### 网页读取不到正文

可能原因：

- 页面内容由 JavaScript 动态加载。
- 需要登录态 Cookie。
- 页面禁止非浏览器客户端访问。

可以尝试：

- 配置 Cookie/Header。
- 使用网页里的静态接口。
- 手动导出网页为文本或 Markdown 后用 `/file` 加载。

## IT 审查要点

源码包：

```text
agent-source-vendor.zip
```

正式包：

```text
agent-win7-x64.zip
```

审查说明：

- EXE 版由 Go 1.20 构建为 Windows x64 控制台程序。
- Go 版不依赖外部 Go module。
- 脚本版只使用 Win7 自带组件。
- 本地命令执行默认关闭。
- 文档改写默认只写新文件，不覆盖原文件。
- 配置文件中的 API Key、Cookie、Token 由用户本地维护，不应进入仓库。

## 升级和回退

升级：

1. 备份当前目录的 `config\agent.json` 和自定义 `skills\`。
2. 解压新版本。
3. 把旧配置和自定义 skills 复制到新目录。
4. 运行 `agent.exe version` 或 `agent.exe chat` 验证。

回退：

1. 保留旧版本目录。
2. 如果新版本异常，直接切回旧目录运行。
3. 不需要卸载系统组件。

## 快速检查清单

首次试用时按顺序检查：

1. 已复制 `config\agent.example.json` 为 `config\agent.json`。
2. 已填写 `base_url` 和 `model`。
3. 如需鉴权，已填写 `api_key` 或 Header。
4. `agent.exe chat` 或 `agent.cmd chat` 能启动。
5. 输入一个简单问题能收到模型回复。
6. 用 `/file notes.md` 测试本地文本读取。
7. 用 `/url http://intranet/` 测试内网页面读取。
8. 如需命令执行，再开启 `command.enabled` 并只配置只读命令。
