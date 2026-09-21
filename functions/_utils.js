/**
 * Cloudflare Pages Functions 共享工具库
 * 提供环境变量解析、自动回退机制、流式聚合控制、OpenAI responses 兼容及全格式响应提取
 */

// 跨域响应头
export const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Key, X-Client-Endpoint, X-Client-Model',
};

/**
 * 处理 OPTIONS 预检请求
 */
export function handleOptions() {
    return new Response(null, {
        status: 204,
        headers: corsHeaders,
    });
}

/**
 * 包装 JSON 响应
 */
export function jsonResponse(data, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            ...corsHeaders,
            ...extraHeaders,
        },
    });
}

/**
 * 包装错误响应
 */
export function errorResponse(message, status = 500, details = null) {
    console.error(`[API Error] ${status}: ${message}`, details || '');
    return jsonResponse({
        error: {
            message,
            status,
            details: details ? (typeof details === 'object' ? JSON.stringify(details) : String(details)) : undefined,
        }
    }, status);
}

/**
 * 解析并规范化流式控制模式
 * @returns {'stream' | 'non-stream' | null}
 */
export function resolveStreamMode(env) {
    const raw = (env.FORCE_STREAM || env.STREAM_MODE || '').toString().trim().toLowerCase();
    if (['true', '1', 'stream', 'yes'].includes(raw)) {
        return 'stream';
    }
    if (['false', '0', 'non-stream', 'no'].includes(raw)) {
        return 'non-stream';
    }
    return null; // 未配置，按原生规则
}

/**
 * 推断 API 类型 (openai / response / gemini)
 */
export function detectApiType(url, explicitType) {
    if (explicitType) {
        const type = explicitType.trim().toLowerCase();
        if (['response', 'responses'].includes(type)) return 'response';
        if (['gemini', 'google'].includes(type)) return 'gemini';
        if (['openai', 'custom', 'claude'].includes(type)) return 'openai';
    }
    const lowerUrl = (url || '').toLowerCase();
    if (lowerUrl.includes('/responses')) return 'response';
    if (lowerUrl.includes('generativelanguage.googleapis.com') || lowerUrl.includes('googlegemini')) return 'gemini';
    return 'openai';
}

/**
 * 解析 AI 配置（支持主 API、额外 API 回退主 API、Embedding API）
 */
export function resolveConfig(env, target = 'main', clientOverrides = {}) {
    // 1. 主 API 配置
    const mainKey = (env.AI_API_KEY || env.AI_KEY || env.API_KEY || env.OPENAI_API_KEY || '').trim();
    let mainUrl = (env.AI_API_URL || env.AI_BASE_URL || env.AI_URL || env.OPENAI_BASE_URL || 'https://api.openai.com/v1').trim();
    mainUrl = mainUrl.replace(/\/+$/, '');
    const mainModel = (env.AI_MODEL || env.MODEL || 'gpt-4o-mini').trim();
    const mainType = detectApiType(mainUrl, env.AI_TYPE);

    const mainConfig = {
        key: mainKey,
        url: mainUrl,
        model: mainModel,
        type: mainType,
    };

    if (target === 'main') {
        return {
            key: clientOverrides.key || mainConfig.key,
            url: (clientOverrides.url ? clientOverrides.url.replace(/\/+$/, '') : mainConfig.url),
            model: clientOverrides.model || mainConfig.model,
            type: detectApiType(clientOverrides.url || mainConfig.url, clientOverrides.type || mainConfig.type),
            isFallback: false,
        };
    }

    if (target === 'extra') {
        // 2. 额外 API 配置：若未配置则回退到主 API
        const extraKey = (env.EXTRA_AI_API_KEY || env.EXTRA_API_KEY || env.EXTRA_KEY || '').trim();
        let extraUrl = (env.EXTRA_AI_URL || env.EXTRA_BASE_URL || env.EXTRA_AI_BASE_URL || '').trim();
        if (extraUrl) extraUrl = extraUrl.replace(/\/+$/, '');
        const extraModel = (env.EXTRA_AI_MODEL || env.EXTRA_MODEL || '').trim();
        const extraType = env.EXTRA_AI_TYPE ? detectApiType(extraUrl, env.EXTRA_AI_TYPE) : '';

        const hasCustomExtra = Boolean(extraKey || extraUrl || extraModel);

        const mergedKey = clientOverrides.key || extraKey || mainConfig.key;
        const mergedUrl = (clientOverrides.url ? clientOverrides.url.replace(/\/+$/, '') : '') || extraUrl || mainConfig.url;
        const mergedModel = clientOverrides.model || extraModel || mainConfig.model;
        const mergedType = detectApiType(mergedUrl, clientOverrides.type || extraType || mainConfig.type);

        return {
            key: mergedKey,
            url: mergedUrl,
            model: mergedModel,
            type: mergedType,
            isFallback: !hasCustomExtra && !clientOverrides.key,
        };
    }

    if (target === 'embedding') {
        // 3. 嵌入 API 配置
        const embUrl = (env.EMBEDDING_API_URL || env.EMBEDDING_BASE_URL || env.EMBEDDING_URL || '').trim();
        const embKey = (env.EMBEDDING_API_KEY || env.EMBEDDING_KEY || mainConfig.key || '').trim();
        const embModel = (env.EMBEDDING_MODEL || 'text-embedding-3-small').trim();

        const hasEmbeddingConfig = Boolean(embUrl || clientOverrides.url);

        return {
            hasConfig: hasEmbeddingConfig,
            key: clientOverrides.key || embKey,
            url: (clientOverrides.url ? clientOverrides.url.replace(/\/+$/, '') : '') || (embUrl ? embUrl.replace(/\/+$/, '') : ''),
            model: clientOverrides.model || embModel,
        };
    }

    return mainConfig;
}

/**
 * 通用响应提取器（深度兼容 OpenAI Chat / Responses API / Claude / Gemini / 直接属性）
 */
export function extractTextFromAnyResponse(data) {
    if (!data) return '';
    if (typeof data === 'string') return data;

    // 1. 标准 OpenAI Chat Completions
    if (data.choices && Array.isArray(data.choices) && data.choices.length > 0) {
        const choice = data.choices[0];
        if (choice.message && typeof choice.message.content === 'string') {
            return choice.message.content;
        }
        if (typeof choice.text === 'string') {
            return choice.text;
        }
    }

    // 2. OpenAI 新版 Responses API (/v1/responses)
    if (data.output_text && typeof data.output_text === 'string') {
        return data.output_text;
    }
    if (data.output && Array.isArray(data.output)) {
        for (const item of data.output) {
            if (item.content && Array.isArray(item.content)) {
                const textPart = item.content.find(c => c.type === 'text' || typeof c.text === 'string');
                if (textPart && textPart.text) return textPart.text;
            }
            if (typeof item.text === 'string') return item.text;
        }
    }

    // 3. Google Gemini 格式
    if (data.candidates && Array.isArray(data.candidates) && data.candidates.length > 0) {
        const cand = data.candidates[0];
        if (cand.content && cand.content.parts && Array.isArray(cand.content.parts)) {
            const partsText = cand.content.parts.map(p => p.text || '').join('');
            if (partsText) return partsText;
        }
    }

    // 4. Anthropic Claude 格式
    if (data.content && Array.isArray(data.content) && data.content.length > 0) {
        const textBlock = data.content.find(b => b.type === 'text');
        if (textBlock && textBlock.text) return textBlock.text;
    }

    // 5. 其他直接字段
    if (typeof data.response === 'string') return data.response;
    if (typeof data.reply === 'string') return data.reply;
    if (typeof data.result === 'string') return data.result;

    return JSON.stringify(data);
}

/**
 * 流式聚合器：当客户端请求非流式，但上游被强制流式时，在服务端聚合 SSE 流为完整文本
 */
export async function aggregateStreamResponse(upstreamResponse) {
    const reader = upstreamResponse.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let fullText = '';
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // 保留未完整的最后一行

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(':')) continue; // 跳过空行或注释
            if (trimmed.startsWith('data:')) {
                const dataStr = trimmed.replace(/^data:\s*/, '');
                if (dataStr === '[DONE]') continue;

                try {
                    const chunk = JSON.parse(dataStr);
                    // 兼容 OpenAI Chat 流式 delta
                    if (chunk.choices && chunk.choices[0]?.delta?.content) {
                        fullText += chunk.choices[0].delta.content;
                    } 
                    // 兼容 OpenAI Responses 流式 delta
                    else if (chunk.delta && typeof chunk.delta === 'string') {
                        fullText += chunk.delta;
                    } else if (chunk.output_text && typeof chunk.output_text === 'string') {
                        fullText += chunk.output_text;
                    }
                    // 兼容 Gemini 流式 chunk
                    else if (chunk.candidates && chunk.candidates[0]?.content?.parts) {
                        const chunkText = chunk.candidates[0].content.parts.map(p => p.text || '').join('');
                        fullText += chunkText;
                    }
                } catch (e) {
                    // 非 JSON 文本 chunk
                }
            }
        }
    }

    return fullText;
}

/**
 * 统一向上游发送 AI 对话请求（支持 OpenAI / Responses API / Gemini）
 */
export async function callUpstreamAI(config, body, forceStreamMode = null, clientAcceptsStream = false) {
    if (!config.key) {
        throw new Error('未配置 API Key，请在 Cloudflare Pages 环境变量中设置，或在前端自定义配置');
    }

    // 判断最终上游是否走流式
    let upstreamStream = false;
    if (forceStreamMode === 'stream') {
        upstreamStream = true;
    } else if (forceStreamMode === 'non-stream') {
        upstreamStream = false;
    } else {
        upstreamStream = Boolean(body.stream || clientAcceptsStream);
    }

    const { messages = [], temperature = 0.8, max_tokens, maxOutputTokens } = body;
    const tokensLimit = max_tokens || maxOutputTokens || 8192;

    let targetEndpoint = '';
    let requestHeaders = {
        'Content-Type': 'application/json',
    };
    let requestBody = {};

    if (config.type === 'gemini') {
        // ========== Google Gemini 格式 ==========
        const base = config.url.replace(/\/+$/, '');
        const modelName = config.model;
        targetEndpoint = `${base}/models/${modelName}:${upstreamStream ? 'streamGenerateContent?alt=sse&' : 'generateContent?'}key=${config.key}`;

        const contents = messages
            .filter(m => m.role !== 'system')
            .map(m => ({
                role: m.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: m.content || '' }]
            }));

        const systemInstruction = messages.find(m => m.role === 'system')?.content || '';

        requestBody = {
            contents,
            ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
            generationConfig: {
                temperature,
                maxOutputTokens: tokensLimit,
            }
        };
    } else if (config.type === 'response') {
        // ========== OpenAI Responses API (/v1/responses) 格式 ==========
        const base = config.url.replace(/\/+$/, '');
        targetEndpoint = base.endsWith('/responses') ? base : `${base}/responses`;
        requestHeaders['Authorization'] = `Bearer ${config.key}`;

        // 提取系统提示词与输入历史
        const systemPrompt = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
        const userAndAssistant = messages.filter(m => m.role !== 'system');

        requestBody = {
            model: config.model,
            input: userAndAssistant.length > 0 ? userAndAssistant : (body.input || ''),
            ...(systemPrompt ? { instructions: systemPrompt } : {}),
            temperature,
            stream: upstreamStream,
        };
    } else {
        // ========== 标准 OpenAI Chat Completions 格式 ==========
        const base = config.url.replace(/\/+$/, '');
        targetEndpoint = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
        requestHeaders['Authorization'] = `Bearer ${config.key}`;

        requestBody = {
            model: config.model,
            messages,
            temperature,
            max_tokens: tokensLimit,
            stream: upstreamStream,
        };
    }

    console.log(`[Upstream Request] Type: ${config.type}, Model: ${config.model}, Stream: ${upstreamStream}, Target: ${targetEndpoint.split('?')[0]}`);

    const response = await fetch(targetEndpoint, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`上游 AI 服务报错 (${response.status}): ${errText.substring(0, 300)}`);
    }

    // 处理响应
    if (upstreamStream) {
        // 上游是流式
        if (clientAcceptsStream) {
            // 客户端也要流式，直接透明透传
            return new Response(response.body, {
                status: 200,
                headers: {
                    'Content-Type': 'text/event-stream; charset=utf-8',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    ...corsHeaders,
                },
            });
        } else {
            // 客户端是非流式，聚合 SSE 流后再返回 JSON
            const fullContent = await aggregateStreamResponse(response);
            return jsonResponse({
                id: 'chatcmpl-' + Date.now(),
                object: 'chat.completion',
                model: config.model,
                choices: [
                    {
                        message: {
                            role: 'assistant',
                            content: fullContent,
                        },
                        finish_reason: 'stop',
                    }
                ],
                content: fullContent,
            });
        }
    } else {
        // 上游是非流式
        const data = await response.json();
        const extractedText = extractTextFromAnyResponse(data);
        return jsonResponse({
            id: data.id || ('chatcmpl-' + Date.now()),
            object: 'chat.completion',
            model: config.model,
            choices: [
                {
                    message: {
                        role: 'assistant',
                        content: extractedText,
                    },
                    finish_reason: 'stop',
                }
            ],
            content: extractedText,
            raw: data,
        });
    }
}
