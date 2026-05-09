```javascript
const emailValidator = {
  validate: async (email) => {
    try {
      if (!email || typeof email !== 'string') {
        throw new Error('Invalid email address');
      }

      const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
      if (!emailRegex.test(email)) {
        throw new Error('Invalid email address');
      }

      return { valid: true, email };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }
};

module.exports = emailValidator;
```