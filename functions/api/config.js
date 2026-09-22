import { handleOptions, jsonResponse, resolveConfig, resolveStreamMode } from '../_utils.js';

export async function onRequestOptions() {
    return handleOptions();
}

export async function onRequestGet(context) {
    const { env } = context;

    const main = resolveConfig(env, 'main');
    const extra = resolveConfig(env, 'extra');
    const emb = resolveConfig(env, 'embedding');
    const streamMode = resolveStreamMode(env);

    // 探测当前已注入的非空环境变量键名（不暴露密钥值本身）
    const detectedEnvKeys = Object.keys(env || {}).filter(k => {
        const val = env[k];
        return typeof val === 'string' && val.trim().length > 0;
    });

    return jsonResponse({
        success: true,
        managedByEnv: Boolean(main.key),
        hasMainConfig: Boolean(main.key),
        mainEndpoint: main.url,
        mainModel: main.model,
        mainType: main.type,
        hasExtraConfig: !extra.isFallback,
        extraEndpoint: extra.url,
        extraModel: extra.model,
        extraType: extra.type,
        extraIsFallback: extra.isFallback,
        hasEmbeddingConfig: emb.hasConfig,
        embeddingModel: emb.model,
        streamMode: streamMode || 'auto',
        detectedEnvKeys: detectedEnvKeys,
    });
}
