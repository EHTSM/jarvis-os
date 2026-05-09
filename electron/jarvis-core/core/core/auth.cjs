const fs = require("fs");

function register(user) {

  let users = [];

  try {
    users = JSON.parse(fs.readFileSync("core/users.json"));
  } catch {}

  users.push(user);

  fs.writeFileSync("core/users.json", JSON.stringify(users, null, 2));

  return { success: true };
}

module.exports = { register };