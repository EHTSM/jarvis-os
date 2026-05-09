const BASE_URL = "http://localhost:5050";

export async function sendMessage(input) {
  const res = await fetch(`${BASE_URL}/jarvis`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input })
  });

  return res.json();
}