async function plan(command) {

  const msg = command.toLowerCase();

  if (msg.includes("yes") || msg.includes("interested")) {
    return [{ action: "auto_close", command }];
  }

  if (msg.includes("hello")) {
    return [{ action: "reply", command }];
  }

  return [{ action: "unknown", command }];
}

module.exports = plan;