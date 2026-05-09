"use strict";
const { loadWorld, flushWorld, metaLog, uid, NOW, ok, fail } = require("./_metaverseStore.cjs");

const AGENT = "worldGenerator3D";

// Backend generates scene DATA — Three.js renders it client-side
const OBJECT_TEMPLATES = {
    floor:      { geometry:"PlaneGeometry", args:[200,200], position:{x:0,y:0,z:0}, rotation:{x:-1.5708,y:0,z:0}, material:"MeshStandardMaterial" },
    sky:        { geometry:"SphereGeometry", args:[500,32,32], position:{x:0,y:0,z:0}, material:"MeshBasicMaterial", side:"BackSide" },
    wall:       { geometry:"BoxGeometry",   args:[1,4,20],    position:{x:0,y:2,z:0}, material:"MeshStandardMaterial" },
    tree:       { geometry:"CylinderGeometry",args:[0,1.5,4,8], position:{x:0,y:2,z:0}, material:"MeshStandardMaterial" },
    building:   { geometry:"BoxGeometry",   args:[8,12,8],    position:{x:0,y:6,z:0}, material:"MeshStandardMaterial" },
    sphere_art: { geometry:"SphereGeometry",args:[1,32,32],   position:{x:0,y:1,z:0}, material:"MeshStandardMaterial" },
    podium:     { geometry:"CylinderGeometry",args:[2,2,1,32], position:{x:0,y:0.5,z:0}, material:"MeshStandardMaterial" },
    portal:     { geometry:"TorusGeometry", args:[3,0.4,16,100], position:{x:0,y:3,z:0}, material:"MeshStandardMaterial" }
};

const THEME_PALETTES = {
    futuristic: { sky:"#0a0a2e", ground:"#1a1a3e", accent:"#00ffff", fog:"#0a0a2e" },
    nature:     { sky:"#87ceeb", ground:"#228b22", accent:"#90ee90", fog:"#ffffff" },
    urban:      { sky:"#708090", ground:"#808080", accent:"#ffd700", fog:"#708090" },
    fantasy:    { sky:"#9b59b6", ground:"#27ae60", accent:"#f39c12", fog:"#9b59b6" },
    abstract:   { sky:"#2c3e50", ground:"#e74c3c", accent:"#3498db", fog:"#2c3e50" },
    corporate:  { sky:"#ecf0f1", ground:"#bdc3c7", accent:"#2980b9", fog:"#ecf0f1" },
    underwater: { sky:"#006994", ground:"#004c70", accent:"#00ced1", fog:"#006994" },
    space:      { sky:"#000010", ground:"#1a1a2e", accent:"#ff6b6b", fog:"#000010" },
    retro:      { sky:"#ff7f50", ground:"#ffd700", accent:"#ff4500", fog:"#ff7f50" }
};

function _generateObjects(worldType, theme, count = 20) {
    const objects = [];
    const palette = THEME_PALETTES[theme] || THEME_PALETTES.futuristic;
    const templates = Object.entries(OBJECT_TEMPLATES);

    // always add floor + sky
    objects.push({ id:uid("obj"), ...OBJECT_TEMPLATES.floor, color: palette.ground, receiveShadow:true });
    objects.push({ id:uid("obj"), ...OBJECT_TEMPLATES.sky,   color: palette.sky });

    const worldObjectMap = {
        social:      ["sphere_art","podium","portal"],
        office:      ["building","wall","podium"],
        classroom:   ["podium","wall"],
        gaming:      ["building","sphere_art","portal"],
        marketplace: ["building","podium"],
        gallery:     ["sphere_art","podium","wall"],
        conference:  ["podium","wall","building"],
        event:       ["podium","portal","sphere_art"],
        sandbox:     ["tree","building","sphere_art","wall"]
    };
    const allowed = worldObjectMap[worldType] || templates.map(([k])=>k);

    for (let i = 0; i < Math.min(count, 50); i++) {
        const tplKey = allowed[Math.floor(Math.random() * allowed.length)];
        const tpl    = OBJECT_TEMPLATES[tplKey];
        const spread = 60;
        objects.push({
            id:       uid("obj"),
            type:     tplKey,
            ...tpl,
            position: { x: parseFloat(((Math.random()-0.5)*spread).toFixed(2)), y: tpl.position.y, z: parseFloat(((Math.random()-0.5)*spread).toFixed(2)) },
            color:    Math.random() > 0.5 ? palette.accent : palette.ground,
            castShadow: true,
            receiveShadow: true
        });
    }
    return objects;
}

function generateScene({ worldId, objectCount = 20 }) {
    if (!worldId) return fail(AGENT, "worldId required");
    const world = loadWorld(worldId);
    if (!world) return fail(AGENT, `worldId ${worldId} not found`);
    if (world.status === "deleted") return fail(AGENT, "world has been deleted");

    const palette  = THEME_PALETTES[world.theme] || THEME_PALETTES.futuristic;
    const objects  = _generateObjects(world.worldType, world.theme, objectCount);
    const scene = {
        sceneId:     uid("sc"),
        worldId,
        worldType:   world.worldType,
        theme:       world.theme,
        rendererHint:"THREE.WebGLRenderer",
        camera:      { fov:75, near:0.1, far:1000, position: world.settings?.spawnPoint || { x:0, y:5, z:15 } },
        lighting:    world.sceneConfig?.lights || [],
        fog:         { color: palette.fog, density: world.settings?.fogDensity || 0.02 },
        physics:     { gravity: world.settings?.gravity ?? -9.8, engine:"client_side_only" },
        palette,
        objects,
        objectCount: objects.length,
        xrSupported: true,
        generatedAt: NOW()
    };

    // cache on world
    world.lastScene = { sceneId: scene.sceneId, generatedAt: scene.generatedAt, objectCount: scene.objectCount };
    world.updatedAt = NOW();
    flushWorld(worldId, world);

    metaLog(AGENT, worldId, "scene_generated", { sceneId: scene.sceneId, objectCount: objects.length }, "INFO");
    return ok(AGENT, scene, { renderNote: "Send sceneData to Three.js client — backend does NOT render" });
}

function getSceneTemplate({ worldType = "social", theme = "futuristic" }) {
    const palette = THEME_PALETTES[theme] || THEME_PALETTES.futuristic;
    return ok(AGENT, {
        worldType, theme, palette,
        availableObjects: Object.keys(OBJECT_TEMPLATES),
        availableThemes:  Object.keys(THEME_PALETTES),
        rendererInstructions: {
            library:    "Three.js r160+",
            xr:         "WebXR Device API",
            shadows:    "PCFSoftShadowMap",
            colorSpace: "SRGBColorSpace"
        }
    });
}

function addSceneObject({ worldId, userId, objectType, position, color, metadata = {} }) {
    if (!worldId || !userId) return fail(AGENT, "worldId and userId required");
    if (!OBJECT_TEMPLATES[objectType]) return fail(AGENT, `objectType must be: ${Object.keys(OBJECT_TEMPLATES).join(", ")}`);
    const world = loadWorld(worldId);
    if (!world) return fail(AGENT, `worldId ${worldId} not found`);

    const obj = {
        id:        uid("obj"),
        type:      objectType,
        ...OBJECT_TEMPLATES[objectType],
        position:  position || OBJECT_TEMPLATES[objectType].position,
        color:     color || "#ffffff",
        addedBy:   userId,
        metadata,
        addedAt:   NOW()
    };
    world.assets.push({ ref: "scene_object", objId: obj.id, type: objectType, addedBy: userId, addedAt: obj.addedAt });
    world.updatedAt = NOW();
    flushWorld(worldId, world);

    metaLog(AGENT, userId, "scene_object_added", { worldId, objectType, objId: obj.id }, "INFO");
    return ok(AGENT, obj);
}

module.exports = { generateScene, getSceneTemplate, addSceneObject };
