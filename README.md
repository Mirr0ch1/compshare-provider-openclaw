<div align="center">

# compshare-provider

**OpenClaw 插件:以 OpenAI Responses 协议接入优云智算 (CompShare / ModelVerse) 的 GLM 5.3 Flash 与 DeepSeek V4.1 Flash**

*OpenClaw plugin: bring UCloud CompShare (优云智算 / ModelVerse) GLM 5.3 Flash & DeepSeek V4.1 Flash to OpenClaw over the OpenAI Responses API*

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-2026.9.3-blue.svg)](https://github.com/openclaw/openclaw)
[![Provider](https://img.shields.io/badge/provider-compshare-0064ff.svg)](https://www.compshare.cn)
[![Transport](https://img.shields.io/badge/transport-openai--responses-orange.svg)](https://www.compshare.cn/docs/modelverse/models/text_api/response_api)
[![Regions](https://img.shields.io/badge/regions-CN%20%7C%20overseas-purple.svg)](#端点矩阵--endpoint-matrix)

</div>

---

## 简介 / Introduction

本插件把**优云智算 (CompShare / ModelVerse)** 托管的编程模型注册为 OpenClaw 的文本推理 Provider:

- `glm-5.3-flash` —— 智谱 GLM 5.3 Flash
- `deepseek-v4.1-flash` —— DeepSeek V4.1 Flash

两者都走 **OpenAI Responses 兼容端点**(`POST /v1/responses`),而不是 Chat Completions。

This plugin registers the CompShare-hosted coding models `glm-5.3-flash` and
`deepseek-v4.1-flash` as first-class OpenClaw providers over the **OpenAI Responses**
endpoint.

### 为什么优先用 Responses?/ Why Responses first?

Responses 协议里 **reasoning 是一等公民**:网关会把思考过程作为独立的 `reasoning` output item 返回,
OpenClaw 能原生解析、原生回传,不需要像 Chat Completions 那样靠 `reasoning_content` 字符串在上下文中
来回搬运:

```jsonc
// GLM 5.3 Flash —— 思考走 content / reasoning_text
{ "type": "reasoning", "content": [{ "type": "reasoning_text", "text": "..." }], "summary": [] }

// DeepSeek V4.1 Flash —— 思考走 summary / summary_text
{ "type": "reasoning", "summary": [{ "type": "summary_text", "text": "..." }] }
```

两种形状 OpenClaw 的 Responses transport 都支持(流式与非流式),所以本插件不做任何 reasoning
转写hack。

---

## 特性 / Highlights

| | |
|---|---|
| 🌏 **三端点** | 中国大陆按量、中国大陆 Agent Plan(套餐)、境外按量,一个插件全覆盖 |
| 🧠 **原生推理** | `reasoning` 作为一等 output item,流式与非流式都可解析、可回传 |
| 🖼️ **多模态** | 两款模型都支持图片输入(`input_image`) |
| 🎚️ **思考等级可控** | `/think off` 对 DeepSeek 是**确定性**关闭思考(不是"看运气") |
| 🔌 **零配置默认** | 只填 API Key 即可用,默认走中国大陆按量端点 |
| 🩺 **按实测写死上限** | `maxTokens` / `contextWindow` 来自网关自己的报错与厂商规格,不是猜的 |

---

## 端点矩阵 / Endpoint matrix

| `region` | `surface` | Base URL | 说明 / Notes |
|---|---|---|---|
| `cn`(默认) | `api`(默认) | `https://api.modelverse.cn/v1` | 中国大陆按量计费 |
| `cn` | `plan` | `https://cp.compshare.cn/v1` | Agent Plan / Coding Plan 套餐,**需套餐专属 Key** |
| `overseas` | `api` | `https://api.umodelverse.ai/v1` | 境外(无法访问 `.cn` 域名时) |

> **套餐端点只存在于中国大陆。** `region: "overseas"` + `surface: "plan"` 不会拼出一个必然 404 的
> URL,而是回退到境外按量端点。
>
> **两种 Key 不通用。** 把按量 Key 发到 `cp.compshare.cn` 会得到 `{"error":"invalid api key"}`;
> 套餐 Key 需要在 [个人套餐管理](https://console.compshare.cn/light-gpu/model-manage) 单独获取。

---

## 模型 / Models

| 模型 ID | 输入 | 上下文 | 最大输出 | 可关闭思考 | Capability |
|---|---|---|---|---|---|
| `glm-5.3-flash` | text + image | 1,048,576 | 131,072 | ❌ 始终思考 | 混合线性/稀疏注意力 MoE,原生多模态 |
| `deepseek-v4.1-flash` | text + image | 1,048,576 | 393,216 | ✅ `effort: "none"` | 原生视觉 MoE |

`maxTokens` 直接来自网关的上限报错(它自己说的 `[1, 131072]` / `[1, 393216]`),不是保守估计。

### 价格 / Pricing(CNY / 百万 token,按量端点)

| 模型 | 输入 | 缓存读取 | 输出 |
|---|---|---|---|
| `glm-5.3-flash` | ¥0.8 | ¥0.23 | ¥2.8 |
| `deepseek-v4.1-flash`(峰时 09:00–12:00 / 14:00–18:00) | ¥2 | ¥0.04 | ¥8 |
| `deepseek-v4.1-flash`(谷时) | ¥1 | ¥0.02 | ¥4 |

> OpenClaw 的 `cost` 字段是美元口径,而 CompShare 计价是人民币。为避免把人民币数字标成美元,
> 本插件**不声明 `cost`**。如需成本统计,可自行在 `models.providers.compshare.models[].cost`
> 里按需覆盖。

---

## 安装 / Installation

### 方式一:ClawHub

```bash
openclaw plugins install clawhub:@mirr0ch1/compshare-provider
```

### 方式二:从源码加载

```bash
git clone https://github.com/Mirr0ch1/compshare-provider.git ~/coding/compshare-provider
```

然后在 `~/.openclaw/openclaw.json` 里挂载:

```jsonc
{
  "plugins": {
    "allow": ["compshare-provider"],
    "load": { "paths": ["~/coding/compshare-provider"] },
    "entries": {
      "compshare-provider": {
        "enabled": true,
        "config": { "region": "cn", "surface": "api" }
      }
    }
  }
}
```

### 写入 API Key

```bash
echo 'COMPSHARE_API_KEY=your-key-here' >> ~/.openclaw/.env
```

最后把 provider 写进 `models.providers`(模型选择器读的是这里,插件目录用于动态发现),
并允许这些模型被 agent 使用:

```jsonc
{
  "models": {
    "providers": {
      "compshare": {
        "baseUrl": "https://api.modelverse.cn/v1",
        "apiKey": "${COMPSHARE_API_KEY}",
        "api": "openai-responses",
        "timeoutSeconds": 7200,
        "models": [
          { "id": "glm-5.3-flash", "name": "GLM 5.3 Flash", "reasoning": true,
            "input": ["text", "image"], "contextWindow": 1048576, "maxTokens": 131072,
            "api": "openai-responses",
            "compat": { "supportedReasoningEfforts": ["low", "medium", "high"] } },
          { "id": "deepseek-v4.1-flash", "name": "DeepSeek V4.1 Flash", "reasoning": true,
            "input": ["text", "image"], "contextWindow": 1048576, "maxTokens": 393216,
            "api": "openai-responses",
            "compat": { "supportedReasoningEfforts": ["none", "low", "medium", "high"] } }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "modelPolicy": { "allow": ["compshare/glm-5.3-flash", "compshare/deepseek-v4.1-flash"] }
    }
  }
}
```

```bash
systemctl --user restart openclaw-gateway   # 或 openclaw gateway restart
```

---

## 配置 / Configuration

### 环境变量

| 变量 | 说明 |
|---|---|
| `COMPSHARE_API_KEY` | 首选。按量 Key 或套餐 Key 都填这里(取决于 `surface`) |
| `MODELVERSE_API_KEY` | 别名,按需使用 |

### 插件配置项

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `region` | `"cn"` \| `"overseas"` | `"cn"` | 调用哪个区域的部署 |
| `surface` | `"api"` \| `"plan"` | `"api"` | 中国大陆端点下的计费面:按量 or Agent Plan |
| `baseUrl` | `string` | — | 显式覆盖,优先级最高(代理 / 未来端点) |

解析优先级:**`baseUrl` > `region` + `surface` 查表 > 该区域的按量端点**。

### 三种端点怎么写

```jsonc
// 中国大陆 · 按量(默认)
"config": { "region": "cn", "surface": "api" }

// 中国大陆 · Agent Plan / Coding Plan(记得换成套餐 Key)
"config": { "region": "cn", "surface": "plan" }
// → "models.providers.compshare.baseUrl" 同步改成 "https://cp.compshare.cn/v1"

// 境外
"config": { "region": "overseas" }
```

> `region`/`surface` 只决定插件动态发现(dynamic catalog)时用的 baseUrl。
> 真正的请求地址来自 `models.providers.compshare.baseUrl` —— 换端点时**两处一起改**。

---

## 使用 / Usage

```bash
# 指定模型跑一轮
openclaw agent --agent main --model compshare/glm-5.3-flash -m "解释一下这个正则"

# 思考等级
openclaw agent --agent main --model compshare/deepseek-v4.1-flash --thinking off -m "17*23=?"
```

会话里也可以用别名与 `/think`:

```
/model modelverse/glm-5.3-flash
/think high
```

### 思考等级 / Thinking levels

| OpenClaw level | 发到网关的 `reasoning.effort` | GLM 5.3 Flash | DeepSeek V4.1 Flash |
|---|---|---|---|
| `off` | `none`(仅 DeepSeek) / **不发该字段**(GLM) | 仍在思考(上游不支持关闭) | ✅ 确定性关闭思考 |
| `low` | `low` | 思考 | 思考 |
| `medium` | `medium` | 思考 | 思考 |
| `high` | `high` | 思考 | 思考 |

默认 `high`——GLM 反正一直思考,让 DeepSeek 保持同一模式,两个模型在 agent loop 里行为一致。

---

## 实测行为 / Verified upstream behaviour

以下结论全部来自 2026-09 对 `api.modelverse.cn` / `api.umodelverse.ai` 的真实请求(含一个前置抓包代理),
不是从文档抄的:

**1. OpenClaw 对 `off` 默认**不发** `reasoning` 字段** —— 抓包结果:

| CLI | 实际请求体 |
|---|---|
| `--thinking high` | `"reasoning": {"effort": "high", "summary": "auto"}` + `include: ["reasoning.encrypted_content"]` |
| `--thinking medium` | `"reasoning": {"effort": "medium", "summary": "auto"}` |
| `--thinking off` | **没有 `reasoning` 字段** |

字段缺失时 DeepSeek 会"看心情"思考 —— 三次相同请求的 `reasoning_tokens` 为 **0 / 29 / 41**。
显式发 `{"effort": "none"}` 后稳定为 **0 / 0 / 0**。这就是本插件要用 `wrapStreamFn` 补这一刀的原因。

**2. GLM 5.3 Flash 无法关闭思考,并且会为此报错。** 网关在 Responses 端点上直接说明:

> 该模型始终思考,不支持关闭思考;请使用 low、high 或 max。

对流式请求携带 `reasoning.effort: "none"`,它会直接返回 `response.failed`。这个拦截是**间歇性**触发的
(大多数请求会溜过去),所以正确做法是**根本不发这个字段**,而不是"发了赌它不拦"。
因此 `"none"` 不在 GLM 声明的 `supportedReasoningEfforts` 里,插件也不会给它打补丁。

**3. 两款模型都真的能读图。** 用一张 64×64 纯红 PNG 测试:GLM 答 `Red`,DeepSeek 答
`Solid bright red square image.` —— 所以两者都声明 `input: ["text", "image"]`。

**4. 其它被网关接受的参数:** `include: ["reasoning.encrypted_content"]`、`reasoning.summary: "auto"`、
`max_output_tokens`、`background`、`context_management` 都不会报错。

**5. `previous_response_id` 传了不存在的值** 会 `not_found` 失败;OpenClaw 的 Responses transport
自己会重试去掉该字段,插件无需额外清洗。

**6. 多轮 reasoning 回传是通的。** 把上一轮的 `reasoning` item 原样回传(两种形状都测过)不会报错,
OpenClaw 的多轮上下文也验证正常(391 → 782)。

---

## 故障排查 / Troubleshooting

| 现象 | 原因 / 处理 |
|---|---|
| `{"error":"invalid api key"}` | 用按量 Key 打了套餐端点(或反过来)。套餐 Key 去[个人套餐管理](https://console.compshare.cn/light-gpu/model-manage)取 |
| 模型不在 `openclaw models list` 里 | 只加了插件目录。还需要写 `models.providers.compshare`(见上文完整示例) |
| `not allowed for agent ... by agents.defaults.modelPolicy.allow` | 把 `compshare/glm-5.3-flash` 等加进 `modelPolicy.allow` |
| `该模型始终思考,不支持关闭思考` | 对 GLM 发了 `effort: "none"`。本插件已规避;自定义 baseUrl 或手工改 body 时注意 |
| 空回复(有 reasoning 但没正文) | 输出预算被思考吃光了。调高 `maxTokens`,或对 DeepSeek 用 `/think off` |
| 改了端点不生效 | `region`/`surface` 与 `models.providers.compshare.baseUrl` 是两处,需同步 |

---

## 更新日志 / Changelog

**v1.0.0**(2026-09-17)
- 首个版本:注册 `glm-5.3-flash` 与 `deepseek-v4.1-flash`,走 OpenAI Responses
- 三端点支持:中国大陆按量 / 中国大陆 Agent Plan / 境外按量
- 思考等级映射;对 DeepSeek 强制 `effort: "none"` 让 `/think off` 确定性生效,
  对 GLM 则刻意不发该字段(上游会拒绝)
- 两款模型声明图片输入;`maxTokens` 按网关实际上限设置

---

## 许可 / License

[MIT](LICENSE)
