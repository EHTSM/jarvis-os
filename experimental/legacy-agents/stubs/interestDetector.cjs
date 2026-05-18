class InterestDetector {
    isHot(message) {
        const text = message.toLowerCase();

        return (
            text.includes("price") ||
            text.includes("buy") ||
            text.includes("start") ||
            text.includes("interested") ||
            text.includes("yes")
        );
    }
}

module.exports = { InterestDetector };