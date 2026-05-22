package doctemplate

import (
	"fmt"
	"sort"
	"strings"
)

var templates = map[string]string{
	"meeting": `请起草一份中文会议材料。主题：%s。语气：%s。
要求包含：会议标题、会议目的、时间地点占位、参会人员、议程、讨论事项、行动项和注意事项。`,
	"email": `请起草一封中文办公邮件。主题：%s。语气：%s。
要求包含：邮件标题、称呼、正文、明确诉求、截止时间或下一步、礼貌结尾。`,
	"notice": `请起草一份中文通知。主题：%s。语气：%s。
要求包含：标题、背景、事项说明、对象范围、时间安排、联系人和注意事项。`,
	"report": `请起草一份中文工作报告。主题：%s。语气：%s。
要求包含：标题、背景、进展、问题、风险、下一步计划和需要协调事项。`,
	"summary": `请起草一份中文总结。主题：%s。语气：%s。
要求包含：摘要、关键结论、事实依据、待办事项和后续建议。`,
	"proposal": `请起草一份中文方案。主题：%s。语气：%s。
要求包含：目标、现状、方案设计、实施步骤、风险控制、资源需求和验收标准。`,
}

func BuildDraftPrompt(kind, topic, tone string) (string, error) {
	kind = strings.ToLower(strings.TrimSpace(kind))
	topic = strings.TrimSpace(topic)
	tone = strings.TrimSpace(tone)
	if topic == "" {
		topic = "未命名主题"
	}
	if tone == "" {
		tone = "正式、清晰、适合公司内部沟通"
	}
	tpl, ok := templates[kind]
	if !ok {
		return "", fmt.Errorf("unknown document type %q; available: %s", kind, strings.Join(Types(), ", "))
	}
	return fmt.Sprintf(tpl, topic, tone), nil
}

func Types() []string {
	out := make([]string, 0, len(templates))
	for key := range templates {
		out = append(out, key)
	}
	sort.Strings(out)
	return out
}
