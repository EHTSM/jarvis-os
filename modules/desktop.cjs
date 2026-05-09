const robot = require("robotjs");

function openApp(appName) {
  const { exec } = require("child_process");

  exec(`open -a "${appName}"`, (err) => {
    if (err) console.log("❌ App open failed:", err);
    else console.log("🚀 Opened:", appName);
  });
}

function typeText(text) {
  robot.typeString(text);
}

function click(x, y) {
  robot.moveMouse(x, y);
  robot.mouseClick();
}

module.exports = {
  openApp,
  typeText,
  click
};