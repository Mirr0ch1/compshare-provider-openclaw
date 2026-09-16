/**
 * CompShare (优云智算 / ModelVerse) provider plugin for OpenClaw.
 *
 * Registers the CompShare-hosted coding models — GLM 5.3 Flash and
 * DeepSeek V4.1 Flash — as first-class OpenClaw providers speaking the
 * OpenAI **Responses** API (`POST /v1/responses`).
 *
 * Responses is preferred over Chat Completions because reasoning is a
 * first-class output item there: the gateway returns `reasoning` items with
 * `reasoning_text` content (GLM) or `summary_text` summaries (DeepSeek), and
 * OpenClaw replays them natively instead of round-tripping a `reasoning_content`
 * string through the completions path.
 *
 * Three endpoints are supported, all three verified against the live gateway:
 *
 *   region cn       + surface api   https://api.modelverse.cn/v1    pay-as-you-go
 *   region cn       + surface plan  https://cp.compshare.cn/v1      Agent / Coding Plan
 *   region overseas + surface api   https://api.umodelverse.ai/v1   pay-as-you-go (outside CN)
 *
 * The Agent Plan surface exists on the China mainland endpoint only, and uses
 * a dedicated plan key: the pay-as-you-go key is rejected there with
 * `{"error":"invalid api key"}`. Putting `region: "overseas"` with
 * `surface: "plan"` therefore falls back to the overseas pay-as-you-go
 * endpoint rather than building a URL that cannot work.
 *
 * Upstream behaviour measured on api.modelverse.cn (2026-09):
 *   - `reasoning.effort: "none"` genuinely disables thinking on
 *     deepseek-v4.1-flash (0 reasoning tokens, repeatedly). glm-5.3-flash
 *     cannot be turned off at all: it keeps emitting a reasoning item, and a
 *     *streaming* request carrying `effort: "none"` is rejected outright with
 *     `response.failed` — "该模型始终思考，不支持关闭思考；请使用 low、high 或
 *     max。" That guard fires intermittently, so the field is simply never sent
 *     for this model.
 *   - Both models accept `input_image` and answer questions about it, so both
 *     advertise `input: ["text", "image"]`.
 *   - `include: ["reasoning.encrypted_content"]`, `reasoning.summary`
 *     (`"auto"`), `max_output_tokens`, `background` and `context_management`
 *     are all accepted without complaint.
 *   - An unknown `previous_response_id` fails with `not_found`; OpenClaw's
 *     Responses transport already retries such a request without it, so no
 *     defensive scrubbing is needed here.
 *
 * Why this plugin patches the request body even though OpenClaw's Responses
 * transport normally injects `reasoning.effort` on its own — measured with a
 * capture proxy in front of the provider (2026-09):
 *   `--thinking high` -> `reasoning: {effort: "high", summary: "auto"}`
 *   `--thinking medium` -> `reasoning: {effort: "medium", summary: "auto"}`
 *   `--thinking off` -> no `reasoning` field at all
 * With the field absent, DeepSeek thinks non-deterministically (0 / 29 / 41
 * reasoning tokens across three identical calls), so `/think off` would be a
 * coin flip. Forcing `reasoning: {effort: "none"}` makes it a deterministic
 * 0 / 0 / 0. GLM needs the opposite treatment and is left untouched.
 *
 * Deliberately NOT implemented:
 *   - No replay hooks. Reasoning round-tripping for the `openai-responses`
 *     transport (including `encrypted_content`) is core-owned.
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { streamWithPayloadPatch } from "openclaw/plugin-sdk/provider-stream";

const PLUGIN_ID = "compshare-provider";
const PROVIDER_ID = "compshare";

/** Defaults chosen so a bare `providers: ["compshare"]` does the obvious thing. */
const DEFAULT_REGION = "cn";
const DEFAULT_SURFACE = "api";

/**
 * Base URL per region/surface. Every value here was exercised with a real
 * request; nothing is inferred from naming patterns.
 */
const ENDPOINTS = {
  cn: {
    api: "https://api.modelverse.cn/v1",
    plan: "https://cp.compshare.cn/v1",
  },
  overseas: {
    api: "https://api.umodelverse.ai/v1",
  },
};

/**
 * Reasoning efforts each model actually accepts, as declared to OpenClaw.
 *
 * `deepseek-v4.1-flash` honours `"none"` — three identical calls produced
 * 0/0/0 reasoning tokens with it, versus a non-deterministic 0/29/41 when the
 * field is omitted — so it declares the full ladder.
 *
 * `glm-5.3-flash` cannot stop thinking. The gateway says so outright on the
 * Responses endpoint:
 *   该模型始终思考，不支持关闭思考；请使用 low、high 或 max。
 * and answers a streaming request carrying `reasoning.effort: "none"` with
 * `response.failed`. That guard fires intermittently (it reproduces, but most
 * attempts slip through), which is exactly why the field must never be sent
 * for this model rather than sent-and-hoped. `"none"` is therefore absent
 * from GLM's declared ladder — which also makes core's own effort resolver
 * drop the field instead of substituting `"none"`.
 */
const DEEPSEEK_EFFORTS = ["none", "low", "medium", "high"];
const GLM_EFFORTS = ["low", "medium", "high"];

/**
 * Models hosted by CompShare that this plugin exposes natively.
 *
 * `maxTokens` limits are the gate's own reported ceilings, read straight out
 * of its rejection messages:
 *   glm-5.3-flash       -> "限制数值范围[1, 131072]"
 *   deepseek-v4.1-flash -> "the valid range of max_tokens is [1, 393216]"
 *
 * `contextWindow` is the vendor-published 1M window for both models.
 */
const MODEL_DEFS = [
  {
    id: "glm-5.3-flash",
    name: "GLM 5.3 Flash",
    input: ["text", "image"],
    contextWindow: 1048576,
    maxTokens: 131072,
    compat: { supportedReasoningEfforts: GLM_EFFORTS },
    canDisableThinking: false,
  },
  {
    id: "deepseek-v4.1-flash",
    name: "DeepSeek V4.1 Flash",
    input: ["text", "image"],
    contextWindow: 1048576,
    maxTokens: 393216,
    compat: { supportedReasoningEfforts: DEEPSEEK_EFFORTS },
    canDisableThinking: true,
  },
];

/** Thinking levels surfaced to the user. */
const THINKING_LEVELS = ["off", "low", "medium", "high"];

function trimTrailingSlashes(value) {
  return value.trim().replace(/\/+$/, "");
}

function readPluginConfig(config) {
  const entry = config?.plugins?.entries?.[PLUGIN_ID];
  return entry?.config && typeof entry.config === "object" ? entry.config : {};
}

function resolveRegion(cfg) {
  const region = typeof cfg?.region === "string" ? cfg.region.trim().toLowerCase() : "";
  return Object.hasOwn(ENDPOINTS, region) ? region : DEFAULT_REGION;
}

function resolveSurface(cfg) {
  return cfg?.surface === "plan" ? "plan" : DEFAULT_SURFACE;
}

/**
 * Resolve the endpoint to talk to.
 *
 * Precedence: explicit `baseUrl` override > `region`/`surface` lookup >
 * the region's pay-as-you-go endpoint. A region without a plan surface
 * (overseas) degrades to its pay-as-you-go endpoint instead of producing a
 * URL that would always 404.
 */
function resolveBaseUrl(cfg) {
  const explicit = typeof cfg?.baseUrl === "string" ? trimTrailingSlashes(cfg.baseUrl) : "";
  if (explicit) {
    return explicit;
  }
  const table = ENDPOINTS[resolveRegion(cfg)];
  return table[resolveSurface(cfg)] ?? table.api;
}

function buildModels() {
  return MODEL_DEFS.map(({ canDisableThinking, ...def }) => ({
    ...def,
    api: "openai-responses",
    reasoning: true,
  }));
}

function findModelDef(modelId) {
  if (typeof modelId !== "string") {
    return undefined;
  }
  // Tolerate a `provider/model` reference arriving where a bare id is expected.
  const id = modelId.trim().toLowerCase().split("/").pop();
  return MODEL_DEFS.find((def) => def.id === id);
}

/**
 * The `reasoning.effort` this plugin insists on, or `undefined` to leave the
 * request exactly as core built it.
 *
 * This deliberately returns a value for one case only — thinking `off` on a
 * model that can genuinely stop thinking. Every other level is already put on
 * the wire correctly by OpenClaw's own Responses transport (verified with a
 * capture proxy: `low` -> `{effort:"low"}`, `medium` -> `{effort:"medium"}`,
 * `high` -> `{effort:"high"}`), so re-stating them here would only add a way
 * to fight the host — and would misfire for any extra CompShare model a user
 * adds under this provider that does not accept the field.
 *
 * `off` is different: core omits the field entirely, which leaves the gateway
 * on its own default. For DeepSeek that default is "think whenever", so `/think
 * off` would be a coin flip. For GLM the field must stay absent, because
 * sending `effort: "none"` gets a streaming request rejected outright.
 */
function resolveForcedEffort(modelId, thinkingLevel) {
  if (thinkingLevel !== "off") {
    return undefined;
  }
  return findModelDef(modelId)?.canDisableThinking ? "none" : undefined;
}

export default definePluginEntry({
  id: PLUGIN_ID,
  name: "CompShare Provider",
  description:
    "Registers UCloud CompShare (优云智算 ModelVerse) GLM 5.3 Flash and DeepSeek V4.1 Flash " +
    "as an OpenClaw provider over the OpenAI Responses API, across the China mainland " +
    "pay-as-you-go, Agent Plan and overseas endpoints.",

  register(api) {
    api.registerProvider({
      id: PROVIDER_ID,
      label: "CompShare",
      aliases: ["modelverse"],
      envVars: ["COMPSHARE_API_KEY", "MODELVERSE_API_KEY"],

      catalog: {
        run: async (ctx) => {
          const apiKey = ctx.resolveProviderApiKey(PROVIDER_ID).apiKey;
          if (!apiKey) {
            return null;
          }
          return {
            provider: {
              baseUrl: resolveBaseUrl(readPluginConfig(ctx.config)),
              api: "openai-responses",
              apiKey,
              models: buildModels(),
            },
          };
        },
      },

      // These models only speak Responses. An explicit
      // `models.providers.compshare` block keeps its own baseUrl, but a stale
      // `api: "openai-completions"` there would silently drop the whole point
      // of this plugin, so normalise the transport back.
      normalizeTransport: (ctx) => {
        if (String(ctx.provider ?? "").trim().toLowerCase() !== PROVIDER_ID) {
          return undefined;
        }
        return {
          api: "openai-responses",
          ...(ctx.baseUrl ? {} : { baseUrl: resolveBaseUrl(readPluginConfig(ctx.config)) }),
        };
      },

      // Core drops the `reasoning` field entirely for `off`, which leaves the
      // gateway on its own default. Pin the effort explicitly for the models
      // that can act on it — see `resolveForcedEffort`.
      wrapStreamFn: (ctx) => {
        const baseStreamFn = ctx.streamFn;
        if (!baseStreamFn) {
          return undefined;
        }
        const effort = resolveForcedEffort(ctx.modelId, ctx.thinkingLevel);
        if (!effort) {
          return undefined;
        }
        return (model, context, options) => {
          if (String(model?.provider ?? "").trim().toLowerCase() !== PROVIDER_ID) {
            return baseStreamFn(model, context, options);
          }
          return streamWithPayloadPatch(baseStreamFn, model, context, options, (payload) => {
            const reasoning =
              payload.reasoning && typeof payload.reasoning === "object" ? payload.reasoning : {};
            reasoning.effort = effort;
            payload.reasoning = reasoning;
          });
        };
      },

      // Thinking on by default: GLM thinks unconditionally anyway, and keeping
      // DeepSeek in the same mode makes the two models behave alike in an
      // agent loop. Use `/think off` to get DeepSeek's non-thinking path.
      resolveThinkingProfile: () => ({
        levels: THINKING_LEVELS.map((id) => ({ id })),
        defaultLevel: "high",
      }),
    });
  },
});
