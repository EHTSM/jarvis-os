/**
 * Content Agents — barrel export of the content/*.cjs implementation
 * files. Required by executor.cjs solely to confirm each file loads
 * cleanly. imageProcessorAgent.cjs (real sharp-based upscale/edit) is
 * exported here too but registered separately in bootstrapRuntime.cjs
 * under a task-type adapter (its export shape is {upscale, edit}, not
 * run(task), like its siblings below).
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
    contentScheduler:  require("./contentScheduler.cjs"),
    imageProcessor:    require("./imageProcessorAgent.cjs")
};

module.exports = CONTENT_AGENTS;
