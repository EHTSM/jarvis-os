"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { resolveCapability, TASK_TYPE_MAP } = require("../../agents/runtime/taskRouter.cjs");

describe("taskRouter — capability mapping", () => {

    describe("browser capabilities", () => {
        const browserTypes = ["web_search", "open_url", "open_google", "open_youtube",
            "open_chatgpt", "open_github", "open_twitter", "open_linkedin",
            "open_instagram", "open_whatsapp", "open_stackoverflow"];

        for (const type of browserTypes) {
            it(`${type} → browser`, () => {
                assert.equal(resolveCapability(type), "browser");
            });
        }
    });

    describe("desktop capabilities", () => {
        const desktopTypes = ["open_app", "type_text", "press_key", "key_combo"];
        for (const type of desktopTypes) {
            it(`${type} → desktop`, () => {
                assert.equal(resolveCapability(type), "desktop");
            });
        }
    });

    describe("specialist capabilities", () => {
        it("terminal → terminal",   () => assert.equal(resolveCapability("terminal"),   "terminal"));
        it("dev → dev",             () => assert.equal(resolveCapability("dev"),        "dev"));
        it("research → research",   () => assert.equal(resolveCapability("research"),   "research"));
        it("automation → automation", () => assert.equal(resolveCapability("automation"), "automation"));
        it("speak → voice",         () => assert.equal(resolveCapability("speak"),      "voice"));
        it("timer → system",        () => assert.equal(resolveCapability("timer"),      "system"));
        it("reminder → crm",        () => assert.equal(resolveCapability("reminder"),   "crm"));
        it("queue_task → task_queue", () => assert.equal(resolveCapability("queue_task"), "task_queue"));
        it("note → crm",            () => assert.equal(resolveCapability("note"),       "crm"));
        it("ai → ai",               () => assert.equal(resolveCapability("ai"),         "ai"));
    });

    describe("fallback behavior", () => {
        it("unknown type falls back to ai", () => {
            assert.equal(resolveCapability("completely_unknown_xyz"), "ai");
        });
        it("empty string falls back to ai", () => {
            assert.equal(resolveCapability(""), "ai");
        });
        it("undefined falls back to ai", () => {
            assert.equal(resolveCapability(undefined), "ai");
        });
    });

    describe("TASK_TYPE_MAP completeness", () => {
        it("has at least 20 entries", () => {
            assert.ok(Object.keys(TASK_TYPE_MAP).length >= 20);
        });
        it("every value is a non-empty string", () => {
            for (const [k, v] of Object.entries(TASK_TYPE_MAP)) {
                assert.equal(typeof v, "string", `${k} capability should be a string`);
                assert.ok(v.length > 0, `${k} capability should not be empty`);
            }
        });
    });
});
