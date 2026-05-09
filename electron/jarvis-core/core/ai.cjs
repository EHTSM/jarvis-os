const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: "__n8n_BLANK_VALUE_e5362baf-c777-4d57-a609-6eaf1f9e87f6",
});

async function generateText(prompt) {
  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
  });

  return response.choices[0].message.content;
}

module.exports = generateText;