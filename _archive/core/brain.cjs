import dotenv from "dotenv";
dotenv.config();

const provider = process.env.LLM_PROVIDER;

export async function brain(input) {
  console.log("🧠 Provider:", provider);

  // 🔵 GROQ
  if (provider === "groq") {
    const Groq = (await import("groq-sdk")).default;

    const client = new Groq({
      apiKey: process.env.GROQ_API_KEY
    });

    const models = [
      "llama-3.1-8b-instant",
      "llama-3.1-70b-versatile",
      "llama-3.2-3b-preview"
    ];

    let lastError;

    for (let model of models) {
      try {
        console.log("🔄 Trying model:", model);

        const chat = await client.chat.completions.create({
          model,
          messages: [
            {
              role: "system",
              content: `
You are Jarvis AI.

Return JSON only:

{
  "intent": "string",
  "tasks": [
    {
      "name": "task_name",
      "agent": "agent_name",
      "tool": "tool_name",
      "workflow": "workflow_name"
    }
  ]
}

If agent/tool/workflow does not exist → still define it.
`
            },
            { role: "user", content: input }
          ]
        });

        const text = chat.choices[0].message.content;

        // 🔥 JSON SAFE PARSER
        let parsed;

        try {
          const match = text.match(/\{[\s\S]*\}/);
          if (match) {
            parsed = JSON.parse(match[0]);
          } else {
            throw new Error("No JSON found");
          }
        } catch (err) {
          console.log("⚠️ JSON parse failed → fallback");

          parsed = {
            intent: "build_business",
            tasks: ["research", "build_website", "marketing"]
          };
        }

        return parsed;

      } catch (err) {
        console.log("❌ Failed:", model);
        lastError = err;
      }
    }

    throw lastError;
  }

  if (!parsed.tasks || parsed.tasks.length === 0) {
  console.log("⚠️ Empty tasks → fallback applied");

  parsed.tasks = [
    "research",
    "build_website",
    "marketing"
  ];
}

  // 🔴 FALLBACK
  return {
    intent: "build_business",
    tasks: ["research", "build_website", "marketing"]
  };
}