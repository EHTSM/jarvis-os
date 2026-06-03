const express = require('express');
const router = express.Router();
const os = require('os');
const process = require('process');

router.get('/health', async (req, res) => {
    try {
        const uptime = process.uptime();
        const timestamp = new Date().toISOString();
        const status = 'OK';

        const healthCheckResponse = {
            status,
            uptime: `${Math.floor(uptime / 60)} minutes and ${Math.floor(uptime % 60)} seconds`,
            timestamp,
            memoryUsage: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`,
            cpuCount: os.cpus().length,
        };

        res.status(200).json(healthCheckResponse);
    } catch (error) {
        console.error('Error in health check endpoint:', error);
        res.status(500).json({ status: 'ERROR', message: 'Internal Server Error' });
    }
});

module.exports = router;