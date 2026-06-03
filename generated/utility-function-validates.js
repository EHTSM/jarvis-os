const emailValidator = {
  validate: async (email) => {
    try {
      if (typeof email !== 'string') {
        throw new Error('Email must be a string');
      }

      const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
      return emailRegex.test(email);
    } catch (error) {
      throw new Error(`Error validating email: ${error.message}`);
    }
  }
};

module.exports = emailValidator;