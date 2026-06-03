const currencyFormatter = {
  format: async (amount) => {
    try {
      if (typeof amount !== 'number') {
        throw new Error('Invalid amount. Amount must be a number.');
      }

      const formattedAmount = new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
      }).format(amount);

      return formattedAmount;
    } catch (error) {
      throw error;
    }
  },
};

module.exports = currencyFormatter;