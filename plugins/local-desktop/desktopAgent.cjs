/**
 * Desktop Agent — open apps, type text, press keys, move mouse.
 * openApp/typeText/pressKey/pressKeyCombo delegate to agents/primitives.cjs.
 * Mouse/screen methods use robotjs directly (no primitive equivalent needed).
 */

const p = require("./primitives.cjs");

// Lazy load robotjs — only needed for mouse/screen methods
let robot = null;
try {
    robot = require("robotjs");
} catch (error) {
    console.log("⚠️  robotjs not installed - desktop control disabled");
}

class DesktopAgent {
    constructor() {
        this.available = robot !== null;
        this.automationEnabled = process.platform === "darwin";
    }

    async openApp(appName) {
        console.log(`🚀 Opening ${appName}...`);
        const r = await p.openApp(appName);
        if (!r.success) console.error(`❌ Failed to open ${appName}:`, r.error);
        return r.success
            ? { success: true, action: "open_app", app: appName, message: `Opened ${appName}` }
            : { success: false, error: r.error, app: appName };
    }

    async typeText(text, _speed = 50) {
        console.log(`⌨️  Typing: "${(text || "").slice(0, 50)}${(text || "").length > 50 ? "..." : ""}"`);
        const r = await p.typeText(text);
        if (!r.success) { console.error("❌ Type text error:", r.error); return { success: false, error: r.error }; }
        return { success: true, action: "type_text", text: (text || "").slice(0, 100), typed_chars: r.typed_chars };
    }

    async pressKey(key) {
        console.log(`⌨️  Pressing key: ${key}`);
        const r = await p.pressKey(key);
        if (!r.success) { console.error("❌ Key press error:", r.error); return { success: false, error: r.error, key }; }
        return { success: true, action: "press_key", key };
    }

    async pressKeyCombo(modifiers, key) {
        console.log(`⌨️  Pressing: ${modifiers.join("+")}+${key}`);
        const r = await p.pressKeyCombo(modifiers, key);
        if (!r.success) { console.error("❌ Key combo error:", r.error); return { success: false, error: r.error }; }
        return { success: true, action: "press_key_combo", combination: `${r.modifiers.join("+")}+${r.key}` };
    }

    /**
     * Move mouse to position
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     */
    async moveMouse(x, y) {
        try {
            if (!this.available) {
                throw new Error("robotjs not available");
            }

            console.log(`🖱️  Moving mouse to (${x}, ${y})`);

            robot.moveMouse(x, y);

            return {
                success: true,
                action: "move_mouse",
                x: x,
                y: y
            };
        } catch (error) {
            console.error("❌ Mouse move error:", error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Click at current mouse position
     * @param {string} button - "left", "right", "middle"
     */
    async click(button = "left") {
        try {
            if (!this.available) {
                throw new Error("robotjs not available");
            }

            console.log(`🖱️  Clicking ${button} button`);

            robot.click(button);

            return {
                success: true,
                action: "click",
                button: button
            };
        } catch (error) {
            console.error("❌ Click error:", error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Double-click at current position
     */
    async doubleClick(button = "left") {
        try {
            if (!this.available) {
                throw new Error("robotjs not available");
            }

            console.log(`🖱️  Double-clicking ${button} button`);

            robot.click(button);
            robot.click(button);

            return {
                success: true,
                action: "double_click",
                button: button
            };
        } catch (error) {
            console.error("❌ Double-click error:", error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get mouse position
     */
    getMouse() {
        try {
            if (!this.available) {
                throw new Error("robotjs not available");
            }

            const pos = robot.getMousePos();
            return {
                success: true,
                x: pos.x,
                y: pos.y
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get screen size
     */
    getScreenSize() {
        try {
            if (!this.available) {
                throw new Error("robotjs not available");
            }

            const size = robot.getScreenSize();
            return {
                success: true,
                width: size.width,
                height: size.height
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Enable/disable automation
     */
    setAutomationEnabled(enabled) {
        this.automationEnabled = enabled && this.available;
        console.log(`🤖 Automation ${this.automationEnabled ? "enabled" : "disabled"}`);
    }

    /**
     * Get status
     */
    getStatus() {
        return {
            available: this.available,
            enabled: this.automationEnabled,
            platform: process.platform,
            message: this.available
                ? "Desktop automation available"
                : "robotjs not installed - install with: npm install robotjs"
        };
    }
}

module.exports = {
    DesktopAgent
};
