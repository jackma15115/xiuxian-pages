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

        // 路线A：AI 完全由服务端环境变量 (ENV) 托管，忽略前端任何自定义覆盖
        const config = resolveConfig(env, 'main');
        const streamMode = resolveStreamMode(env);

        // 客户端是否显式要求流式
        const acceptHeader = request.headers.get('Accept') || '';
        const clientAcceptsStream = Boolean(body.stream === true || acceptHeader.includes('text/event-stream'));

        return await callUpstreamAI(config, body, streamMode, clientAcceptsStream);
    } catch (error) {
        return errorResponse(error.message || '主 AI 服务请求失败', 500);
    }
}
