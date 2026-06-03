const phoneUtil = require('google-libphonenumber').PhoneNumberUtil;
const phoneUtilInstance = phoneUtil.getInstance();

module.exports = {
  validatePhoneNumber: async (phoneNumber) => {
    try {
      if (!phoneNumber || typeof phoneNumber !== 'string') {
        throw new Error('Invalid phone number');
      }

      const trimmedPhoneNumber = phoneNumber.trim();
      const phoneNumberObject = phoneUtilInstance.parseAndKeepRawInput(trimmedPhoneNumber, 'US');

      if (!phoneUtilInstance.isValidNumber(phoneNumberObject)) {
        throw new Error('Invalid phone number');
      }

      const formattedPhoneNumber = phoneUtilInstance.format(phoneNumberObject, phoneUtilInstance.PhoneNumberFormat.NATIONAL);
      return formattedPhoneNumber;
    } catch (error) {
      throw new Error(`Error validating phone number: ${error.message}`);
    }
  }
};