"use strict";
/**
 * portConflictDetector — probe TCP ports for availability.
 *
 * checkPort(port)        → Promise<{ port, available, error? }>
 * checkPorts(ports[])    → Promise<{ available[], conflicts[] }>
 * findFreePort(start, end?) → Promise<number|null>  — first free port in range
 */

const net = require("net");

function checkPort(port) {
    return new Promise(resolve => {
        const server = net.createServer();
        server.unref();
        server.listen(port, "127.0.0.1", () => {
            server.close(() => resolve({ port, available: true }));
        });
        server.on("error", err => {
            resolve({ port, available: false, error: err.code || err.message });
        });
    });
}

async function checkPorts(ports) {
    const results   = await Promise.all(ports.map(checkPort));
    const available = results.filter(r =>  r.available).map(r => r.port);
    const conflicts = results.filter(r => !r.available).map(r => ({
        port:  r.port,
        error: r.error,
    }));
    return { available, conflicts };
}

async function findFreePort(start = 3000, end = 9999) {
    for (let port = start; port <= end; port++) {
        const { available } = await checkPort(port);
        if (available) return port;
    }
    return null;
}

module.exports = { checkPort, checkPorts, findFreePort };
