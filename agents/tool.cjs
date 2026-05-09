const { exec } = require("child_process");

const SAFE_URLS = {
    open_google: "https://www.google.com",
    open_youtube: "https://www.youtube.com",
    open_chatgpt: "https://chatgpt.com"
};

function openBrowser(urlKey) {
    return new Promise((resolve, reject) => {
        const url = SAFE_URLS[urlKey];

        if (!url) {
            return reject(new Error(`URL key not whitelisted: ${urlKey}`));
        }

        exec(`open "${url}"`, (error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve({ success: true, url });
        });
    });
}

async function toolAgent(task) {
    switch (task.type) {
        case "open_google":
        case "open_youtube":
        case "open_chatgpt": {
            const result = await openBrowser(task.type);
            return {
                type: task.type,
                message: `Opening ${task.label}...`,
                url: result.url
            };
        }
        
        case "open_url": {
    const url = task.url;

    exec(`open "${url}"`);

    return {
        type: "open_url",
        message: `Opening ${task.label}`,
        url
    };
}

        case "search": {
            const query = task.payload?.query || "";
            const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
            return {
                type: "search",
                message: `Search URL generated for query: ${query}`,
                url
            };
        }

        default:
            return null;
    }
}

module.exports = {
    toolAgent
};
