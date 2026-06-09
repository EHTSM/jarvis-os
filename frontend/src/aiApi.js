import { _fetch } from "./_client";

export async function getAIStatus() {
  return _fetch("/ai/status");
}
