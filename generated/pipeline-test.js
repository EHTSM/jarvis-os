function add(a, b) { 
  if (typeof a !== 'number' || typeof b !== 'number') {
    throw new TypeError('Both arguments must be numbers');
  }
  return a + b; 
}
function multiply(a, b) { return a * b; }
module.exports = { add, multiply };