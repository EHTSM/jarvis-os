/**
 * Content Agents Registry — registers all creator engine agents.
 * Import once (executor.cjs) to activate the layer.
 */

const agentManager = require("../multi/agentManager.cjs");

const CONTENT_AGENTS = {
    scriptWriter:      require("./scriptWriterAgent.cjs"),
    captionGenerator:  require("./captionGeneratorAgent.cjs"),
    hashtagGenerator:  require("./hashtagGeneratorAgent.cjs"),
    thumbnail:         require("./thumbnailAgent.cjs"),
    imageGenerator:    require("./imageGeneratorAgent.cjs"),
    videoGenerator:    require("./videoGeneratorAgent.cjs"),
    reelGenerator:     require("./reelGeneratorAgent.cjs"),
    podcastGenerator:  require("./podcastGeneratorAgent.cjs"),
    voiceCloning:      require("./voiceCloningAgent.cjs"),
    contentScheduler:  require("./contentScheduler.cjs")
};

for (const [name, agent] of Object.entries(CONTENT_AGENTS)) {
    if (!agentManager.has(name)) {
        try {
            agentManager.register(name, agent, { category: "content", autoRegistered: true });
        } catch (err) {
            console.error(`[content/index] Failed to register ${name}:`, err.message);
        }
    }
}

module.exports = CONTENT_AGENTS;
