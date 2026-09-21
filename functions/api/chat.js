import { handleOptions, errorResponse, resolveConfig, resolveStreamMode, callUpstreamAI } from '../_utils.js';

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

        // 读取客户端自定义覆盖参数（若有）
        const clientOverrides = {
            key: request.headers.get('X-Client-Key') || body.clientApiKey || '',
            url: request.headers.get('X-Client-Endpoint') || body.clientEndpoint || '',
            model: request.headers.get('X-Client-Model') || body.clientModel || body.model || '',
            type: body.clientType || '',
        };

        const config = resolveConfig(env, 'main', clientOverrides);
        const streamMode = resolveStreamMode(env);

        // 客户端是否显式要求流式
        const acceptHeader = request.headers.get('Accept') || '';
        const clientAcceptsStream = Boolean(body.stream === true || acceptHeader.includes('text/event-stream'));

        return await callUpstreamAI(config, body, streamMode, clientAcceptsStream);
    } catch (error) {
        return errorResponse(error.message || '主 AI 服务请求失败', 500);
    }
}
