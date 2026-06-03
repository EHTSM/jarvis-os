function greet(name) { 
  console.log("greet function called with name: " + name);
  return "Hello, " + name + "!"; 
}
module.exports = { greet };