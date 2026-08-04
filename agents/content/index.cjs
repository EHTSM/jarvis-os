/**
 * Content Agents — barrel export of the 10 content/*.cjs implementation
 * files (9 registered; imageProcessorAgent.cjs is NOT in this list — see
 * module 3 of the unification report for why it stays unregistered).
 * Required by executor.cjs solely to confirm each file loads cleanly.
 *
 * Agent Civilization Unification (module 2): this barrel used to ALSO
 * register each agent into agentManager (agents/multi/'s private shadow
 * registry) under camelCase names (scriptWriter, imageGenerator, ...).
 * agents/runtime/bootstrapRuntime.cjs independently registers the same
 * 10 files into the real, production agentRegistry under different IDs
 * (content_script, content_image, ...) — confirmed 1:1 file coverage.
 * agentManager had zero consumers after module 1, so this was pure
 * duplicate state with no reader. See agents/business/index.cjs for the
 * full rationale (identical pattern, applied consistently here).
 */

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

module.exports = CONTENT_AGENTS;
