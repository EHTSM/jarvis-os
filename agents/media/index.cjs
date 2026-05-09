"use strict";

const MEDIA_AGENTS = {
    // Discovery
    movieRecommendationAgent: require("./movieRecommendationAgent.cjs"),
    ottAggregatorAgent:       require("./ottAggregatorAgent.cjs"),
    musicRecommendationAgent: require("./musicRecommendationAgent.cjs"),
    playlistGenerator:        require("./playlistGenerator.cjs"),
    gamingAssistant:          require("./gamingAssistant.cjs"),

    // Live / Social
    streamModerator:          require("./streamModerator.cjs"),
    chatEngagementBot:        require("./chatEngagementBot.cjs"),
    memeGeneratorPro:         require("./memeGeneratorPro.cjs"),
    gifGenerator:             require("./gifGenerator.cjs"),

    // Creative
    animationCreator:         require("./animationCreator.cjs"),
    storyGenerator:           require("./storyGenerator.cjs"),
    comicCreatorAgent:        require("./comicCreatorAgent.cjs"),
    characterGenerator:       require("./characterGenerator.cjs"),
    avatarCreatorPro:         require("./avatarCreatorPro.cjs"),

    // Persona & SAFETY
    virtualInfluencerAgent:   require("./virtualInfluencerAgent.cjs"),
    likenessController:       require("./likenessController.cjs"),
    contextModerationAI:      require("./contextModerationAI.cjs"),
    copyrightChecker:         require("./copyrightChecker.cjs"),

    // Audio
    voiceActingAgent:         require("./voiceActingAgent.cjs"),
    soundEffectGenerator:     require("./soundEffectGenerator.cjs"),
    backgroundMusicAgent:     require("./backgroundMusicAgent.cjs"),
    podcastEditorAgent:       require("./podcastEditorAgent.cjs"),
    audioCleaner:             require("./audioCleaner.cjs"),

    // Video
    subtitleGenerator:        require("./subtitleGenerator.cjs"),
    dubbingAgent:             require("./dubbingAgent.cjs"),
    videoEditorPro:           require("./videoEditorPro.cjs"),
    sceneDetectionAgent:      require("./sceneDetectionAgent.cjs"),
    clipGenerator:            require("./clipGenerator.cjs"),
    highlightExtractor:       require("./highlightExtractor.cjs"),
    trailerGenerator:         require("./trailerGenerator.cjs"),

    // Optimization
    mediaCompressor:          require("./mediaCompressor.cjs"),
    formatConverter:          require("./formatConverter.cjs"),
    streamingOptimizer:       require("./streamingOptimizer.cjs"),
    cdnManager:               require("./cdnManager.cjs"),
    mediaStorageAI:           require("./mediaStorageAI.cjs"),
    thumbnailOptimizer:       require("./thumbnailOptimizer.cjs"),
    contentPerformanceTracker:require("./contentPerformanceTracker.cjs")
};

module.exports = MEDIA_AGENTS;
