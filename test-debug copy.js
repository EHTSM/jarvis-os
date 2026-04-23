const axios = require("axios");

const BASE_URL = "http://localhost:3000";

async function debugTest() {
    try {
        console.log("📤 Sending request: 'open google and tell me time'\n");
        const res = await axios.post(`${BASE_URL}/jarvis`, {
            command: "open google and tell me time"
        });
        
        console.log("✅ Response received:");
        console.log(JSON.stringify(res.data, null, 2));
        
    } catch (error) {
        console.error("❌ Error:", error.response?.data || error.message);
    }
}

debugTest();
