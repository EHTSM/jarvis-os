"use strict";
/**
 * Postman Collection generator — converts an OpenAPI spec (from
 * openApiGenerator.cjs) into a real Postman Collection v2.1 JSON document.
 *
 * Enterprise Capability Expansion mission. Deliberately NOT a second
 * independent route-introspection pass — the mission requires Postman
 * generation to "derive from OpenAPI spec" with no duplicate work, so this
 * module only ever consumes an already-generated spec object.
 */

function _folderFor(collection, tag) {
    let folder = collection.item.find(f => f.name === tag);
    if (!folder) {
        folder = { name: tag, item: [] };
        collection.item.push(folder);
    }
    return folder;
}

/**
 * toPostmanCollection(spec) -> real Postman Collection v2.1 object
 */
function toPostmanCollection(spec) {
    const collection = {
        info: {
            name: spec.info?.title || "JARVIS-OS API",
            description: spec.info?.description || "",
            schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
        },
        item: [],
        variable: [{ key: "baseUrl", value: (spec.servers && spec.servers[0]?.url) || "/" }],
    };

    for (const [oaPath, methods] of Object.entries(spec.paths || {})) {
        // Postman uses {{var}} style for path vars — OpenAPI {id} converts
        // directly since Postman also accepts {{id}} once path variables
        // are declared; we declare them per-request via the `variable` array.
        const pmPath = oaPath.replace(/\{([A-Za-z0-9_]+)\}/g, ":$1");
        for (const [method, op] of Object.entries(methods)) {
            const tag = (op.tags && op.tags[0]) || "default";
            const folder = _folderFor(collection, tag);
            folder.item.push({
                name: op.summary || `${method.toUpperCase()} ${oaPath}`,
                request: {
                    method: method.toUpperCase(),
                    header: [{ key: "Content-Type", value: "application/json" }],
                    url: {
                        raw: `{{baseUrl}}${pmPath}`,
                        host: ["{{baseUrl}}"],
                        path: pmPath.split("/").filter(Boolean),
                        variable: (op.parameters || []).map(p => ({ key: p.name, value: "" })),
                    },
                },
                response: [],
            });
        }
    }

    return collection;
}

module.exports = { toPostmanCollection };
