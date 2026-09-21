import { handleOptions, jsonResponse, errorResponse, resolveConfig } from '../_utils.js';

export async function onRequestOptions() {
    return handleOptions();
}

async function handleModels(context, clientParams = {}) {
    const { env, request } = context;

    const urlObj = new URL(request.url);
    const target = clientParams.target || urlObj.searchParams.get('target') || 'main';
    const clientKey = clientParams.key || urlObj.searchParams.get('key') || request.headers.get('X-Client-Key') || '';
    const clientEndpoint = clientParams.endpoint || urlObj.searchParams.get('endpoint') || request.headers.get('X-Client-Endpoint') || '';
    const clientType = clientParams.type || urlObj.searchParams.get('type') || '';

    const config = resolveConfig(env, target, {
        key: clientKey,
        url: clientEndpoint,
        type: clientType,
    });

    if (!config.key) {
        return errorResponse('未配置 API Key，无法获取模型列表', 400);
    }

    try {
        let models = [];
        const base = config.url.replace(/\/+$/, '');

        if (config.type === 'gemini') {
            const listEndpoint = `${base}/models?key=${config.key}`;
            const res = await fetch(listEndpoint);
            if (!res.ok) {
                const text = await res.text();
                throw new Error(`Gemini 模型接口错误 (${res.status}): ${text.substring(0, 100)}`);
            }
            const data = await res.json();
            models = (data.models || [])
                .filter(m => m.supportedGenerationMethods?.includes('generateContent') || m.name)
                .map(m => (m.name || '').replace(/^models\//, ''))
                .filter(Boolean);
        } else {
            // OpenAI 兼容格式
            let modelsEndpoint = base;
            if (!modelsEndpoint.endsWith('/models')) {
                modelsEndpoint = `${base}/models`;
            }
            const res = await fetch(modelsEndpoint, {
                headers: {
                    'Authorization': `Bearer ${config.key}`,
                }
            });
            if (!res.ok) {
                const text = await res.text();
                throw new Error(`OpenAI 模型接口错误 (${res.status}): ${text.substring(0, 100)}`);
            }
            const data = await res.json();
            if (Array.isArray(data.data)) {
                models = data.data.map(m => m.id).sort();
            } else if (Array.isArray(data.models)) {
                models = data.models.map(m => m.id || m.name || m).sort();
            }
        }

        return jsonResponse({
            success: true,
            data: models.map(id => ({ id })),
            models: models,
        });
    } catch (error) {
        return errorResponse(error.message || '获取模型列表失败', 500);
    }
}

export async function onRequestGet(context) {
    return handleModels(context);
}

export async function onRequestPost(context) {
    let body = {};
    try {
        body = await context.request.json();
    } catch (e) {}
    return handleModels(context, body);
}
