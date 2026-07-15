import { BASE_URL, _fetch } from "./_client";

export async function checkHealth() {
  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const res   = await fetch(`${BASE_URL}/health`, { signal: ctrl.signal });
    clearTimeout(timer);
    return res.ok;
  } catch { return false; }
}

export async function getStats() {
  try { return await _fetch("/stats"); }
  catch { return null; }
}

export async function getOpsData() {
  try { return await _fetch("/ops"); }
  catch { return null; }
}

export async function getMetrics() {
  try { return await _fetch("/metrics"); }
  catch { return null; }
}

export async function getHealStatus() {
  try { return await _fetch("/p19/heal/status"); }
  catch { return null; }
}
