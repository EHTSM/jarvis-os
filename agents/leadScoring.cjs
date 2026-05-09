class LeadScoring {
    score(lead) {
        let score = 0;

        // Source priority
        if (lead.source === "google_maps") score += 40;
        if (lead.source === "linkedin") score += 30;
        if (lead.source === "fiverr") score += 20;

        // Intent keywords
        const text = JSON.stringify(lead).toLowerCase();

        if (text.includes("need")) score += 20;
        if (text.includes("hire")) score += 20;
        if (text.includes("looking")) score += 20;

        // Rating (for maps)
        if (lead.rating && lead.rating >= 4) score += 10;

        return score;
    }

    filterHot(leads) {
        return leads
            .map(l => ({ ...l, score: this.score(l) }))
            .filter(l => l.score >= 50);
    }
}

module.exports = { LeadScoring };