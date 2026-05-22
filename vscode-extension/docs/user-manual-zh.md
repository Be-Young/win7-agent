# Win7 Agent VS Code 插件中文操作手册

## 适用环境

- 操作系统：Windows 7 x64。
- VS Code：建议固定使用 1.70.3，这是官方说明中 Windows 7 的最后可用版本。
- 网络：办公电脑只需要能访问公司内网的大模型 API 和内网页面。
- 依赖：插件运行不需要安装 Node、Python、Go 或 npm 包。

## 安装

1. 将 `win7-agent-vscode-0.4.3.vsix` 传入内网电脑。
2. 打开 VS Code。
3. 进入扩展面板，点击右上角 `...`。
4. 选择 `Install from VSIX...`，选中该 `.vsix` 文件。
5. 安装后重启 VS Code。

也可以在命令行安装：

```bat
code --install-extension win7-agent-vscode-0.4.3.vsix
```

## 基础配置

打开 VS Code 设置 JSON，写入：

```json
{
  "win7Agent.baseUrl": "http://model-gateway.local/v1/chat/completions",
  "win7Agent.model": "your-model-name",
  "win7Agent.apiKey": ""
}
```

如果内网 API 使用 `/v1` 根路径，也可以写：

```json
{
  "win7Agent.baseUrl": "http://model-gateway.local/v1",
  "win7Agent.model": "your-model-name"
}
```

插件会自动补成 `/v1/chat/completions`。

## 打开聊天

按 `Ctrl+Shift+P`，执行：

```text
Win7 Agent: Open Chat
```

聊天窗口支持：

- 直接提问。
- 点击 `File` 把本地文件加入上下文。
- 点击 `Project` 读取当前 VS Code 打开的项目及项目下的文本文件。
- 点击 `Ref File` 引用某个项目文件。
- 点击 `Skill` 引用某个 skill。
- 点击 `New` 新建会话，当前会话会保存到历史会话。
- 点击 `Sessions` 切换历史会话。
- 点击 `Rename` 修改当前会话标题。
- 点击 `Delete` 删除某个历史会话。
- 点击 `Rollback` 回退上一次由插件应用的项目文件修改。
- 点击 `URL` 把内网页面加入上下文。
- 点击 `Model` 切换模型 profile。
- 点击 `Clear` 清空当前记忆。
- 输入 `@skill:report 帮我写周报` 手动指定 skill。
- 输入 `@file:src/app.js 请解释这个文件` 手动引用文件。

连续工作模式：

1. 直接输入一个任务，例如“阅读当前项目，修复配置读取问题，并更新说明文档”。
2. 插件默认以连续工作模式运行，没有固定步骤上限。
3. 插件会把项目上下文交给模型，模型输出 `agent-files` 修改计划时会自动应用。
4. 每次应用都会保存回退点。
5. 在输入框中连续按两次 `Esc`，会立即中断当前模型请求或正在运行的命令。

聊天消息会把正式回答和辅助内容分开显示。正式回答默认展开，`Think`、`Agent Action`、`Agent Files` 等内容默认折叠，点击标题可以展开查看。

模型修改项目文件时使用如下块：

````text
```agent-files
{"summary":"修改说明","changes":[{"action":"write","path":"src/app.js","content":"新内容"}]}
```
````

支持 `create`、`write`、`replace`、`delete`。插件只允许当前工作区内的相对路径，并拒绝 `../`、绝对路径和盘符路径。

会话管理：

- 每个会话的对话和上下文相互隔离。
- `New` 会创建空白新会话，当前会话自动保留到历史。
- `Sessions` 可以切换历史会话。
- `Rename` 可以更改当前会话标题。
- `Delete` 可以删除指定历史会话。
- `Clear` 只清空当前会话。

## 模型切换

示例配置：

```json
{
  "win7Agent.activeModel": "fast",
  "win7Agent.models": {
    "fast": {
      "baseUrl": "http://model-gateway.local/v1/chat/completions",
      "model": "fast-model",
      "stream": true
    },
    "accurate": {
      "baseUrl": "http://model-gateway.local/v1/chat/completions",
      "model": "accurate-model",
      "stream": false
    }
  }
}
```

切换方式：

```text
Win7 Agent: Switch Model
```

## 文件和文档

插件本身可以直接读取：

- `.txt`
- `.md`
- `.csv`
- `.json`
- `.log`

VSIX 包内带有 `agent.exe` 时，还可以读取和生成：

- `.docx`
- `.xlsx`

执行：

```text
Win7 Agent: Read File into Context
```

或在聊天窗口点击 `File`。

## 生成办公文档

执行：

```text
Win7 Agent: Draft Office Document
```

支持类型：

- `meeting`：会议纪要
- `email`：内部邮件
- `notice`：通知公告
- `report`：工作报告
- `summary`：摘要总结
- `proposal`：方案建议

如果输出文件选择 `.docx` 或 `.xlsx`，插件会调用随包的 `agent.exe` 完成生成。

## 网页读取

执行：

```text
Win7 Agent: Read URL into Context
```

插件支持普通静态 HTML 页面，会提取标题、描述、正文、表格和链接。动态 JavaScript 渲染页面不会执行脚本。

需要 Cookie 或 Header 时：

```json
{
  "win7Agent.authProfiles": {
    "oa": {
      "match": "oa.local",
      "cookie": "SESSION=xxx",
      "headers": {
        "X-User": "zhangsan"
      }
    }
  }
}
```

如果内网 HTTPS 使用自签证书，优先配置公司 CA：

```json
{
  "win7Agent.caFile": "D:\\certs\\company-ca.pem"
}
```

确实无法配置 CA 时，可以临时跳过证书校验：

```json
{
  "win7Agent.insecureSkipVerify": true
}
```

## 命令执行

默认允许执行本地命令。高危前缀会弹窗确认，例如：

- `del`
- `format`
- `reg`
- `powershell`
- `shutdown`
- `diskpart`

完全禁止某些命令：

```json
{
  "win7Agent.command.blockedPrefixes": [
    "format",
    "diskpart"
  ]
}
```

所有命令输出会写入 `Win7 Agent` 输出面板，审计日志保存在 VS Code 扩展的全局存储目录。

## Skill

插件会读取：

- VSIX 内置的 `skills/**/SKILL.md`
- 当前工作区的 `skills/**/SKILL.md`
- `win7Agent.skillsPaths` 配置的目录

Skill 文件可以包含 front matter：

```markdown
---
name: report
description: 周报、月报、工作汇报
keywords: 周报,月报,汇报
---

请输出结构化工作报告。
```

## 记忆

插件会保存：

- 最近对话
- 已加载文件上下文
- 已加载网页上下文

查看：

```text
Win7 Agent: Show Memory
```

清空：

```text
Win7 Agent: Clear Memory
```

## 和 CLI 的关系

VS Code 插件可以独立完成聊天、模型切换、skills、记忆、文本文件、网页读取、命令执行和文档草稿。对于 `.docx`、`.xlsx` 等完整 Office 能力，插件会复用同包的 Win7 `agent.exe`，这样 CLI 和插件共用同一套内核能力。
