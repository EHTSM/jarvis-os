/**
 * Knowledge Portal Agent — internal knowledge base with articles, search, and versioning.
 */

const { load, flush, requireAuth, auditLog, uid, NOW, ok, fail, forbidden } = require("./_enterpriseStore.cjs");

const ARTICLE_CATEGORIES = ["policy","process","technical","hr","legal","product","onboarding","faq","general"];

function createArticle({ tenantId, userId, title, body, category = "general", tags = [], visibility = "all" }) {
    const auth = requireAuth(tenantId, userId, "manager");
    if (!auth.ok) return forbidden("knowledgePortalAgent", auth.error);
    if (!ARTICLE_CATEGORIES.includes(category)) return fail("knowledgePortalAgent", `Invalid category. Use: ${ARTICLE_CATEGORIES.join(", ")}`);
    if (!title || !body) return fail("knowledgePortalAgent", "Title and body are required");

    const article = {
        id:        uid("art"),
        tenantId,
        title:     title.slice(0, 300),
        body:      body.slice(0, 50000),
        category,
        tags:      tags.slice(0, 20).map(t => t.toLowerCase().trim()),
        visibility,
        version:   1,
        history:   [],
        views:     0,
        helpful:   0,
        notHelpful: 0,
        author:    userId,
        createdAt: NOW(),
        updatedAt: NOW()
    };

    const articles = load(tenantId, "kb-articles", []);
    articles.push(article);
    flush(tenantId, "kb-articles", articles.slice(-5000));
    auditLog(tenantId, userId, "kb_article_created", { title, category });
    return ok("knowledgePortalAgent", article);
}

function updateArticle({ tenantId, userId, articleId, title, body, tags, changelog = "" }) {
    const auth = requireAuth(tenantId, userId, "manager");
    if (!auth.ok) return forbidden("knowledgePortalAgent", auth.error);

    const articles = load(tenantId, "kb-articles", []);
    const article  = articles.find(a => a.id === articleId);
    if (!article) return fail("knowledgePortalAgent", "Article not found");

    article.history.push({ version: article.version, title: article.title, body: article.body, editedBy: userId, at: NOW(), changelog });
    article.history = article.history.slice(-10);
    article.version++;
    if (title) article.title = title.slice(0, 300);
    if (body)  article.body  = body.slice(0, 50000);
    if (tags)  article.tags  = tags.slice(0, 20).map(t => t.toLowerCase().trim());
    article.updatedAt = NOW();
    article.updatedBy = userId;

    flush(tenantId, "kb-articles", articles);
    auditLog(tenantId, userId, "kb_article_updated", { articleId, version: article.version });
    return ok("knowledgePortalAgent", { id: article.id, title: article.title, version: article.version, updatedAt: article.updatedAt });
}

function searchArticles({ tenantId, userId, query = "", category = null, tag = null }) {
    const auth = requireAuth(tenantId, userId, "employee");
    if (!auth.ok) return forbidden("knowledgePortalAgent", auth.error);

    let articles = load(tenantId, "kb-articles", []);
    if (category) articles = articles.filter(a => a.category === category);
    if (tag)      articles = articles.filter(a => a.tags.includes(tag.toLowerCase()));

    if (query.trim()) {
        const terms = query.toLowerCase().split(/\s+/);
        articles = articles
            .map(a => {
                const text  = `${a.title} ${a.body} ${a.tags.join(" ")}`.toLowerCase();
                const score = terms.filter(t => text.includes(t)).length;
                return { ...a, _score: score };
            })
            .filter(a => a._score > 0)
            .sort((a, b) => b._score - a._score);
    }

    articles.forEach(a => { a.views = (a.views || 0) + 1; });
    const raw = load(tenantId, "kb-articles", []);
    articles.forEach(found => { const orig = raw.find(r => r.id === found.id); if (orig) orig.views = found.views; });
    flush(tenantId, "kb-articles", raw);

    return ok("knowledgePortalAgent", {
        query, category: category || "all", tag: tag || "all",
        total:    articles.length,
        articles: articles.slice(0, 20).map(a => ({ id: a.id, title: a.title, category: a.category, tags: a.tags, views: a.views, version: a.version, author: a.author, updatedAt: a.updatedAt }))
    });
}

function rateArticle({ tenantId, userId, articleId, helpful }) {
    const auth = requireAuth(tenantId, userId, "employee");
    if (!auth.ok) return forbidden("knowledgePortalAgent", auth.error);

    const articles = load(tenantId, "kb-articles", []);
    const article  = articles.find(a => a.id === articleId);
    if (!article) return fail("knowledgePortalAgent", "Article not found");

    if (helpful) article.helpful++; else article.notHelpful++;
    const total = article.helpful + article.notHelpful;
    flush(tenantId, "kb-articles", articles);
    return ok("knowledgePortalAgent", { articleId, helpful: article.helpful, notHelpful: article.notHelpful, helpfulnessRate: total ? `${Math.round((article.helpful / total) * 100)}%` : "0%" });
}

function getKBStats(tenantId, requesterId) {
    const auth = requireAuth(tenantId, requesterId, "manager");
    if (!auth.ok) return forbidden("knowledgePortalAgent", auth.error);

    const articles  = load(tenantId, "kb-articles", []);
    const byCategory = ARTICLE_CATEGORIES.reduce((m, c) => { m[c] = articles.filter(a => a.category === c).length; return m; }, {});
    const topViewed  = [...articles].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 5);

    return ok("knowledgePortalAgent", {
        tenantId,
        total:      articles.length,
        byCategory,
        topViewed:  topViewed.map(a => ({ id: a.id, title: a.title, views: a.views || 0 })),
        totalViews: articles.reduce((s, a) => s + (a.views || 0), 0)
    });
}

async function run(task) {
    const p = task.payload || {};
    try {
        if (task.type === "create_article")  return createArticle(p);
        if (task.type === "update_article")  return updateArticle(p);
        if (task.type === "search_articles") return searchArticles(p);
        if (task.type === "rate_article")    return rateArticle(p);
        return getKBStats(p.tenantId, p.userId);
    } catch (err) { return fail("knowledgePortalAgent", err.message); }
}

module.exports = { createArticle, updateArticle, searchArticles, rateArticle, getKBStats, ARTICLE_CATEGORIES, run };
