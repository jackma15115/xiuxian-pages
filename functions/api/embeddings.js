import { handleOptions, jsonResponse, errorResponse, resolveConfig } from '../_utils.js';

export async function onRequestOptions() {
    return handleOptions();
}

export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        let body = {};
        try {
            body = await request.json();
        } catch (e) {
            return errorResponse('无效的 JSON 请求体', 400);
        }

        const clientOverrides = {
            key: request.headers.get('X-Client-Key') || body.clientApiKey || '',
            url: request.headers.get('X-Client-Endpoint') || body.clientEndpoint || '',
            model: request.headers.get('X-Client-Model') || body.clientModel || body.model || '',
        };

        const config = resolveConfig(env, 'embedding', clientOverrides);

        // 如果未配置远程嵌入接口，返回 501 状态，提示前端回退到浏览器本地计算
        if (!config.hasConfig) {
            return jsonResponse({
                fallbackToLocal: true,
                message: '未配置远程嵌入接口 (EMBEDDING_API_URL)，默认使用浏览器本地模型计算',
            }, 501);
        }

        const inputText = body.input || body.text || '';
        if (!inputText) {
            return errorResponse('input 或 text 参数不能为空', 400);
        }

        let targetEndpoint = config.url.replace(/\/+$/, '');
        if (!targetEndpoint.endsWith('/embeddings')) {
            targetEndpoint += '/embeddings';
        }

        const requestHeaders = {
            'Content-Type': 'application/json',
        };
        if (config.key) {
            requestHeaders['Authorization'] = `Bearer ${config.key}`;
        }

        const upstreamResponse = await fetch(targetEndpoint, {
            method: 'POST',
            headers: requestHeaders,
            body: JSON.stringify({
                input: typeof inputText === 'string' ? inputText.substring(0, 8000) : inputText,
                model: config.model,
            }),
        });

        if (!upstreamResponse.ok) {
            const errText = await upstreamResponse.text();
            throw new Error(`上游嵌入服务响应失败 (${upstreamResponse.status}): ${errText.substring(0, 200)}`);
        }

        const data = await upstreamResponse.json();
        return jsonResponse(data);
    } catch (error) {
        return errorResponse(error.message || '向量计算请求失败', 500);
    }
}
