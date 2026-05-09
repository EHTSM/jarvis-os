function decideAgent(command) {
  const cmd = command.toLowerCase();

  if (cmd.includes("marketing")) {
    return { name: "Marketing Agent", job: "Generate leads" };
  }

  return { name: "General Agent", job: "Execute tasks" };
}
function think(command) {
  return `AI processed: ${command}`;
}
module.exports = decideAgent;