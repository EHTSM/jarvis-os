/**
 * TestGenerator — one-click unit test generation.
 * Highlights code → generates tests → preview → run pipeline.
 * Lives as a tab in AIPairProgramming.
 */
import React, { useState, useCallback, useEffect } from "react";
import "./TestGenerator.css";

const BASE = process.env.REACT_APP_API_URL || "";

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  return r.json();
}

const FRAMEWORKS = ["jest", "vitest", "mocha", "pytest", "go test"];

const TEST_PROMPTS = [
  "Generate comprehensive unit tests including edge cases and error paths.",
  "Generate snapshot tests and integration tests.",
  "Generate property-based tests.",
  "Generate mock-based tests with dependency injection.",
];

export default function TestGenerator({ cwd, filePath, selection }) {
  const [code,        setCode]        = useState(selection || "");
  const [framework,   setFramework]   = useState("jest");
  const [tests,       setTests]       = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [running,     setRunning]     = useState(false);
  const [runResult,   setRunResult]   = useState(null);
  const [error,       setError]       = useState(null);

  // Pick up selection pushed from editor
  useEffect(() => {
    if (selection) setCode(selection);
  }, [selection]);

  useEffect(() => {
    const handler = (e) => {
      const { capability, payload } = e.detail || {};
      if (capability === "code.generateTests" && payload?.selection) {
        setCode(payload.selection);
      }
    };
    window.addEventListener("jarvis-capability", handler);
    return () => window.removeEventListener("jarvis-capability", handler);
  }, []);

  const generate = useCallback(async () => {
    if (!code.trim() || loading) return;
    setLoading(true);
    setTests(null);
    setError(null);
    setRunResult(null);
    try {
      const fileSuffix = filePath ? `\nFile: ${filePath}` : "";
      const prompt = `Generate ${framework} unit tests for the following code. Include:
- Happy path tests
- Edge case tests
- Error / exception tests
- Mocks for dependencies

Return ONLY the test code, no explanations.${fileSuffix}

Code:
\`\`\`
${code}
\`\`\``;

      const res = await post("/coding/ask", { question: prompt, cwd });
      const raw = res?.answer || res?.text || res?.response || "";
      // Extract code block if present
      const match = raw.match(/```(?:\w+)?\s*([\s\S]*?)```/);
      setTests(match ? match[1].trim() : raw.trim());
    } catch (e) {
      setError("Failed to generate tests. Check your connection.");
    }
    setLoading(false);
  }, [code, framework, loading, cwd, filePath]);

  const runTests = useCallback(async () => {
    if (!tests || running || !window.electronAPI?.shellExec) return;
    setRunning(true);
    setRunResult(null);
    try {
      const cmd = framework === "jest"   ? "npx jest --passWithNoTests 2>&1 | tail -20"
               : framework === "vitest" ? "npx vitest run 2>&1 | tail -20"
               : framework === "pytest" ? "python -m pytest 2>&1 | tail -20"
               : `npm test 2>&1 | tail -20`;
      const r = await window.electronAPI.shellExec({ command: cmd, cwd });
      setRunResult({ ok: r?.ok || r?.exit === 0, output: r?.stdout || r?.stderr || r?.output || "Done" });
    } catch {
      setRunResult({ ok: false, output: "Could not run tests (desktop only)" });
    }
    setRunning(false);
  }, [tests, running, framework, cwd]);

  const saveTests = useCallback(async () => {
    if (!tests || !filePath || !window.electronAPI?.fsWriteFile) return;
    const testPath = filePath.replace(/\.(jsx?|tsx?)$/, ".test.$1").replace(/(\.test)\.1$/, ".test.js");
    await window.electronAPI.fsWriteFile({ filePath: testPath, data: tests });
  }, [tests, filePath]);

  return (
    <div className="tg-root">
      <div className="tg-header">
        <span className="tg-title">Test Generator</span>
        <select
          className="tg-fw-select"
          value={framework}
          onChange={e => setFramework(e.target.value)}
        >
          {FRAMEWORKS.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>

      <div className="tg-code-section">
        <div className="tg-label-row">
          <span className="tg-label">Code to test</span>
          {selection && <span className="tg-badge">From selection</span>}
        </div>
        <textarea
          className="tg-code-area"
          value={code}
          onChange={e => setCode(e.target.value)}
          placeholder="Paste code here, or select text in the editor and right-click → Generate Tests…"
          rows={7}
          spellCheck={false}
        />
      </div>

      <button
        className="tg-generate-btn"
        onClick={generate}
        disabled={!code.trim() || loading}
      >
        {loading ? "Generating…" : "⬡ Generate Tests"}
      </button>

      {error && <div className="tg-error">{error}</div>}

      {tests && (
        <div className="tg-preview">
          <div className="tg-preview-header">
            <span className="tg-label">Generated Tests</span>
            <div className="tg-preview-actions">
              {filePath && window.electronAPI && (
                <button className="tg-action-btn" onClick={saveTests}>Save to file</button>
              )}
              <button
                className="tg-action-btn tg-action-btn--run"
                onClick={runTests}
                disabled={running}
              >
                {running ? "Running…" : "▶ Run"}
              </button>
            </div>
          </div>
          <pre className="tg-code-preview">{tests}</pre>
        </div>
      )}

      {runResult && (
        <div className={`tg-run-result${runResult.ok ? " tg-run-result--ok" : " tg-run-result--fail"}`}>
          <span className="tg-run-status">{runResult.ok ? "✓ Passed" : "✗ Failed"}</span>
          <pre className="tg-run-output">{runResult.output}</pre>
        </div>
      )}
    </div>
  );
}
