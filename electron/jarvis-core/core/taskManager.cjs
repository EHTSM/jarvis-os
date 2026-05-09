function assignTask(agent) {

  if (agent.job.includes("lead")) {
    return "find leads";
  }

  if (agent.job.includes("sales")) {
    return "close client";
  }

  return "general task";
}

module.exports = assignTask;