const messages = [
  "Hey, do you want more customers using AI?",
  "We help businesses get leads daily 🚀",
  "Interested in growth system?"
];

function getMessage() {
  return messages[Math.floor(Math.random() * messages.length)];
}

// 👉 manual DM helper
function generateDMList() {
  const usernames = ["user1", "user2", "user3"];

  usernames.forEach(u => {
    console.log(`Send DM to ${u}: ${getMessage()}`);
  });
}

generateDMList();