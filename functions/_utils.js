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
 * 根据 Base URL 智能推断缺省模型名称（防止用户配置了非 OpenAI 的 URL 但未配 MODEL 导致 404 model_not_found）
 */
export function getDefaultModelForUrl(url) {
    const lower = (url || '').toLowerCase();
    if (lower.includes('deepseek.com')) return 'deepseek-chat';
    if (lower.includes('moonshot.cn') || lower.includes('kimi')) return 'moonshot-v1-8k';
    if (lower.includes('minimax')) return 'abab6.5s-chat';
    if (lower.includes('bigmodel.cn') || lower.includes('zhipu')) return 'glm-4-flash';
    if (lower.includes('dashscope') || lower.includes('aliyun') || lower.includes('qwen')) return 'qwen-plus';
    if (lower.includes('generativelanguage.googleapis.com') || lower.includes('googlegemini')) return 'gemini-1.5-flash';
    if (lower.includes('anthropic.com')) return 'claude-3-5-sonnet-20241022';
    return 'gpt-4o-mini';
}

/**
 * 解析 AI 配置：严格完全使用 Cloudflare Pages 服务端环境变量 (ENV)，忽略前端任何参数干扰
 */
export function resolveConfig(env, target = 'main') {
    // 1. 主 API 配置：严格从环境变量读取
    const mainKey = (
        env.AI_API_KEY ||
        env.AI_KEY ||
        env.API_KEY ||
        env.OPENAI_API_KEY ||
        ''
    ).trim();

    let mainUrl = (
        env.AI_API_URL ||
        env.AI_BASE_URL ||
        env.AI_URL ||
        env.OPENAI_BASE_URL ||
        'https://api.openai.com/v1'
    ).trim().replace(/\/+$/, '');

    // 支持所有常见环境变量名称
    const envMainModel = (
        env.AI_MODEL ||
        env.MODEL ||
        env.AI_API_MODEL ||
        env.OPENAI_MODEL ||
        env.CHAT_MODEL ||
        env.DEFAULT_MODEL ||
        ''
    ).trim();

    // 未指定模型时，根据 URL 智能推断（如 deepseek.com -> deepseek-chat），否则默认 gpt-4o-mini
    const mainModel = envMainModel || getDefaultModelForUrl(mainUrl);
    const mainType = detectApiType(mainUrl, env.AI_TYPE);

    const mainConfig = {
        key: mainKey,
        url: mainUrl,
        model: mainModel,
        type: mainType,
        isFallback: false,
    };

    if (target === 'main') {
        return mainConfig;
    }

    if (target === 'extra') {
        // 2. 额外 API 配置：严格从环境变量读取；若未配置则 100% 自动回退走主 API
        const extraKey = (
            env.EXTRA_AI_API_KEY ||
            env.EXTRA_API_KEY ||
            env.EXTRA_KEY ||
            ''
        ).trim();

        let extraUrl = (
            env.EXTRA_AI_URL ||
            env.EXTRA_BASE_URL ||
            env.EXTRA_AI_BASE_URL ||
            env.EXTRA_URL ||
            ''
        ).trim().replace(/\/+$/, '');

        const envExtraModel = (
            env.EXTRA_AI_MODEL ||
            env.EXTRA_MODEL ||
            env.EXTRA_AI_API_MODEL ||
            ''
        ).trim();

        const hasCustomExtra = Boolean(extraKey || extraUrl || envExtraModel);

        const finalExtraKey = extraKey || mainConfig.key;
        const finalExtraUrl = extraUrl || mainConfig.url;
        const finalExtraModel = envExtraModel || (hasCustomExtra ? getDefaultModelForUrl(finalExtraUrl) : mainConfig.model);
        const finalExtraType = detectApiType(finalExtraUrl, env.EXTRA_AI_TYPE || env.AI_TYPE);

        return {
            key: finalExtraKey,
            url: finalExtraUrl,
            model: finalExtraModel,
            type: finalExtraType,
            isFallback: !hasCustomExtra,
        };
    }

    if (target === 'embedding') {
        // 3. 嵌入 API 配置：严格从环境变量读取
        const embUrl = (
            env.EMBEDDING_API_URL ||
            env.EMBEDDING_BASE_URL ||
            env.EMBEDDING_URL ||
            ''
        ).trim().replace(/\/+$/, '');

        const embKey = (
            env.EMBEDDING_API_KEY ||
            env.EMBEDDING_KEY ||
            mainConfig.key ||
            ''
        ).trim();

        const embModel = (
            env.EMBEDDING_MODEL ||
            env.EMBEDDING_API_MODEL ||
            'text-embedding-3-small'
        ).trim();

        return {
            hasConfig: Boolean(embUrl),
            key: embKey,
            url: embUrl,
            model: embModel,
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
 * 流式转发与保活适配器：将上游各种格式（OpenAI/Responses/Gemini）的流式输出
 * 规范化为统一的 SSE 事件流推向前端，并注入立即保活与心跳保活机制，防止 Cloudflare / 浏览器超时断连
 */
export function createSseForwardStream(upstreamResponse) {
    const reader = upstreamResponse.body.getReader();
    const decoder = new TextDecoder('utf-8');
    const encoder = new TextEncoder();
    let buffer = '';

    return new ReadableStream({
        async start(controller) {
            // 1. 立即发送保活注释行，强制刷新 HTTP 200 响应头与首包给前端
            controller.enqueue(encoder.encode(': keep-alive\n\n'));

            // 2. 心跳保活定时器（每 15 秒输出一次注释），避免因上游长时思考/排队导致的空闲超时
            const pingTimer = setInterval(() => {
                try {
                    controller.enqueue(encoder.encode(': ping\n\n'));
                } catch (e) {
                    clearInterval(pingTimer);
                }
            }, 15000);

            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed || trimmed.startsWith(':')) continue;
                        if (trimmed.startsWith('data:')) {
                            const dataStr = trimmed.replace(/^data:\s*/, '');
                            if (dataStr === '[DONE]') {
                                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                                continue;
                            }

                            try {
                                const chunk = JSON.parse(dataStr);
                                let deltaText = '';

                                // 兼容 OpenAI Chat 流式 delta
                                if (chunk.choices && chunk.choices[0]?.delta?.content) {
                                    deltaText = chunk.choices[0].delta.content;
                                }
                                // 兼容 OpenAI Responses 流式 delta
                                else if (typeof chunk.delta === 'string') {
                                    deltaText = chunk.delta;
                                } else if (chunk.output_text && typeof chunk.output_text === 'string') {
                                    deltaText = chunk.output_text;
                                }
                                // 兼容 Gemini 流式 chunk
                                else if (chunk.candidates && chunk.candidates[0]?.content?.parts) {
                                    deltaText = chunk.candidates[0].content.parts.map(p => p.text || '').join('');
                                }

                                if (deltaText) {
                                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: deltaText })}\n\n`));
                                }
                            } catch (e) {
                                // 如果为非 JSON 文本 chunk，直接作为增量输出
                                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: dataStr })}\n\n`));
                            }
                        }
                    }
                }
                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            } catch (err) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: err.message || 'Stream error' })}\n\n`));
            } finally {
                clearInterval(pingTimer);
                try {
                    controller.close();
                } catch (e) {}
            }
        },
        cancel() {
            reader.cancel();
        }
    });
}

/**
 * 非流式转 SSE 保活流：
 * 当上游走非流式（如 FORCE_STREAM=false 或特定非流式模型），但前端接入 SSE 时，
 * 立即返回流式响应，并在等待上游非流式返回的过程中定时下发心跳保活注释，
 * 彻底避免 Cloudflare 边缘代理的 100/125 秒超时 (Error 524)。
 */
export function createNonStreamSseKeepAliveStream(targetEndpoint, requestHeaders, requestBody, config) {
    const encoder = new TextEncoder();

    return new ReadableStream({
        async start(controller) {
            // 1. 立即向客户端输出保活注释，通知 Cloudflare 边缘刷新 200 OK 响应头
            controller.enqueue(encoder.encode(': keep-alive\n\n'));

            // 2. 每 10 秒发送一次心跳保活注释，保持 TCP 管道活跃
            const pingTimer = setInterval(() => {
                try {
                    controller.enqueue(encoder.encode(': ping\n\n'));
                } catch (e) {
                    clearInterval(pingTimer);
                }
            }, 10000);

            try {
                const response = await fetch(targetEndpoint, {
                    method: 'POST',
                    headers: requestHeaders,
                    body: JSON.stringify(requestBody),
                });

                if (!response.ok) {
                    const errText = await response.text();
                    let detail = errText.substring(0, 300);
                    if (response.status === 404 && errText.includes('model_not_found')) {
                        detail += ` [当前请求模型: "${config.model}", 目标端点: "${targetEndpoint.split('?')[0]}", 请核对环境变量 AI_MODEL]`;
                    }
                    throw new Error(`上游 AI 服务报错 (${response.status}): ${detail}`);
                }

                const data = await response.json();
                const extractedText = extractTextFromAnyResponse(data);

                // 发送提取出的完整文本给前端
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: extractedText })}\n\n`));
                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            } catch (err) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: err.message || '请求失败' })}\n\n`));
            } finally {
                clearInterval(pingTimer);
                try {
                    controller.close();
                } catch (e) {}
            }
        }
    });
}

/**
 * 统一向上游发送 AI 对话请求（支持 OpenAI / Responses API / Gemini）
 */
export async function callUpstreamAI(config, body, forceStreamMode = null, clientAcceptsStream = false) {
    if (!config.key) {
        throw new Error('未配置 API Key，请在 Cloudflare Pages 环境变量中设置，或在前端自定义配置');
    }

    // 判断上游是否走流式：由 FORCE_STREAM 严格决定
    let upstreamStream = true;
    if (forceStreamMode === 'stream') {
        upstreamStream = true;
    } else if (forceStreamMode === 'non-stream') {
        upstreamStream = false;
    } else {
        // 未配置 FORCE_STREAM 时，若客户端请求显式指定了 stream 则遵从，否则默认走流式
        upstreamStream = body.stream !== false;
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

    console.log(`[Upstream Request] Type: ${config.type}, Model: ${config.model}, UpstreamStream: ${upstreamStream}, ClientAcceptsStream: ${clientAcceptsStream}, Target: ${targetEndpoint.split('?')[0]}`);

    // 分支 1：上游走非流式
    if (!upstreamStream) {
        if (clientAcceptsStream) {
            // 客户端以 SSE 接收：立即返回流式保活连接，后台 fetch 完成后推回结果
            const sseStream = createNonStreamSseKeepAliveStream(targetEndpoint, requestHeaders, requestBody, config);
            return new Response(sseStream, {
                status: 200,
                headers: {
                    'Content-Type': 'text/event-stream; charset=utf-8',
                    'Cache-Control': 'no-cache, no-transform',
                    'Connection': 'keep-alive',
                    ...corsHeaders,
                },
            });
        } else {
            // 客户端显式指定非流式时，直接等待 fetch 返回标准 JSON
            const response = await fetch(targetEndpoint, {
                method: 'POST',
                headers: requestHeaders,
                body: JSON.stringify(requestBody),
            });
            if (!response.ok) {
                const errText = await response.text();
                let detail = errText.substring(0, 300);
                if (response.status === 404 && errText.includes('model_not_found')) {
                    detail += ` [当前请求模型: "${config.model}", 目标端点: "${targetEndpoint.split('?')[0]}", 请核对环境变量 AI_MODEL]`;
                }
                throw new Error(`上游 AI 服务报错 (${response.status}): ${detail}`);
            }
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

    // 分支 2：上游走流式
    const response = await fetch(targetEndpoint, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
        const errText = await response.text();
        let detail = errText.substring(0, 300);
        if (response.status === 404 && errText.includes('model_not_found')) {
            detail += ` [当前请求模型: "${config.model}", 目标端点: "${targetEndpoint.split('?')[0]}", 请核对环境变量 AI_MODEL]`;
        }
        throw new Error(`上游 AI 服务报错 (${response.status}): ${detail}`);
    }

    if (clientAcceptsStream) {
        // 前端接入 SSE 流，进行保活与实时透传
        const forwardStream = createSseForwardStream(response);
        return new Response(forwardStream, {
            status: 200,
            headers: {
                'Content-Type': 'text/event-stream; charset=utf-8',
                'Cache-Control': 'no-cache, no-transform',
                'Connection': 'keep-alive',
                ...corsHeaders,
            },
        });
    } else {
        // 客户端显式指定非流式时，在服务端聚合 SSE 流
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
}
