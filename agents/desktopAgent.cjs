/**
 * Desktop Agent - Control system via robotjs
 * Features: open apps, type text, move mouse, press keys
 */

const { exec } = require("child_process");
const { promisify } = require("util");

const execAsync = promisify(exec);

// Lazy load robotjs (optional, may not be available)
let robot = null;
try {
    robot = require("robotjs");
} catch (error) {
    console.log("⚠️  robotjs not installed - desktop control disabled");
}

class DesktopAgent {
    constructor() {
        this.available = robot !== null;
        this.automationEnabled = process.platform === "darwin"; // macOS first
    }

    /**
     * Open an application by name
     * @param {string} appName - Application name (e.g., "Chrome", "VS Code")
     */
    async openApp(appName) {
        try {
            console.log(`🚀 Opening ${appName}...`);

            if (process.platform === "darwin") {
                // macOS: Use open command
                await execAsync(`open -a "${appName}"`);
            } else if (process.platform === "win32") {
                // Windows: Use start command
                await execAsync(`start ${appName}`);
            } else {
                // Linux: Use standard app launcher
                await execAsync(`${appName} &`);
            }

            return {
                success: true,
                action: "open_app",
                app: appName,
                message: `Opened ${appName}`
            };
        } catch (error) {
            console.error(`❌ Failed to open ${appName}:`, error.message);
            return {
                success: false,
                error: error.message,
                app: appName
            };
        }
    }

    /**
     * Type text on the keyboard
     * @param {string} text - Text to type
     * @param {number} speed - Typing speed (ms between chars)
     */
    async typeText(text, speed = 50) {
        try {
            if (!this.available) {
                throw new Error("robotjs not available");
            }

            console.log(`⌨️  Typing: "${text.slice(0, 50)}${text.length > 50 ? "..." : ""}"`);

            robot.typeString(text, speed / 1000);

            return {
                success: true,
                action: "type_text",
                text: text.slice(0, 100),
                typed_chars: text.length
            };
        } catch (error) {
            console.error("❌ Type text error:", error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Press a key
     * @param {string} key - Key name (e.g., "enter", "space", "cmd", "ctrl")
     */
    async pressKey(key) {
        try {
            if (!this.available) {
                throw new Error("robotjs not available");
            }

            console.log(`⌨️  Pressing key: ${key}`);

            // Map common key names
            const keyMap = {
                "enter": ["enter"],
                "return": ["enter"],
                "space": ["space"],
                "tab": ["tab"],
                "esc": ["escape"],
                "escape": ["escape"],
                "delete": ["delete"],
                "backspace": ["backspace"],
                "cmd": ["cmd"],
                "command": ["cmd"],
                "ctrl": ["control"],
                "control": ["control"],
                "alt": ["alt"],
                "option": ["alt"],
                "shift": ["shift"],
                "up": ["up"],
                "down": ["down"],
                "left": ["left"],
                "right": ["right"]
            };

            const keyToPress = keyMap[key.toLowerCase()] || [key];
            robot.keyTap(keyToPress[0]);

            return {
                success: true,
                action: "press_key",
                key: key
            };
        } catch (error) {
            console.error("❌ Key press error:", error.message);
            return {
                success: false,
                error: error.message,
                key: key
            };
        }
    }

    /**
     * Press key combination (Ctrl+C, Cmd+V, etc.)
     * @param {string[]} modifiers - ["ctrl", "cmd", "alt", "shift"]
     * @param {string} key - Main key to press
     */
    async pressKeyCombo(modifiers, key) {
        try {
            if (!this.available) {
                throw new Error("robotjs not available");
            }

            console.log(`⌨️  Pressing: ${modifiers.join("+")}+${key}`);

            // Normalize modifier names
            const mods = modifiers.map(m => {
                const lowered = m.toLowerCase();
                if (lowered === "cmd" || lowered === "command") return "cmd";
                if (lowered === "ctrl" || lowered === "control") return "ctrl";
                if (lowered === "alt" || lowered === "option") return "alt";
                if (lowered === "shift") return "shift";
                return lowered;
            });

            robot.hotkey(...mods, key);

            return {
                success: true,
                action: "press_key_combo",
                combination: `${modifiers.join("+")}+${key}`
            };
        } catch (error) {
            console.error("❌ Key combo error:", error.message);
            return {
                success: false,
                error: error.message
            };
        }
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
