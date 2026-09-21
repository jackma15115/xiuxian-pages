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

    return jsonResponse({
        success: true,
        managedByEnv: Boolean(main.key),
        hasMainConfig: Boolean(main.key),
        mainModel: main.model,
        mainType: main.type,
        hasExtraConfig: !extra.isFallback,
        extraModel: extra.model,
        extraType: extra.type,
        extraIsFallback: extra.isFallback,
        hasEmbeddingConfig: emb.hasConfig,
        embeddingModel: emb.model,
        streamMode: streamMode || 'auto', // 'stream', 'non-stream', or 'auto'
    });
}
