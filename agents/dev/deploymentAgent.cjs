/**
 * Deployment Agent — generates Docker, docker-compose, .env, and deploy scripts.
 */

const path   = require("path");
const fsUtil = require("../core/fileSystem.cjs");

const _dockerfile = (port, nodeVersion) => `FROM node:${nodeVersion}-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE ${port}
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \\
    CMD node -e "require('http').get('http://localhost:${port}/health',r=>process.exit(r.statusCode===200?0:1))"
USER node
CMD ["node", "server.js"]
`;

const _compose = (appName, port, withMongo) => {
    const mongo = withMongo ? `
  mongo:
    image: mongo:7
    restart: unless-stopped
    volumes: [mongo_data:/data/db]
    networks: [app_net]` : "";

    const dep  = withMongo ? "\n    depends_on: [mongo]" : "";
    const vols = withMongo ? "\n  mongo_data:" : "\n  {}";

    return `version: "3.9"
services:
  ${appName}:
    build: .
    restart: unless-stopped
    ports: ["${port}:${port}"]
    env_file: [.env]
    networks: [app_net]${dep}
    healthcheck:
      test: ["CMD","node","-e","require('http').get('http://localhost:${port}/health',r=>process.exit(r.statusCode===200?0:1))"]
      interval: 30s
      timeout: 10s
      retries: 3${mongo}
networks:
  app_net:
    driver: bridge
volumes:${vols}
`;
};

const _dockerignore = () => `node_modules\nnpm-debug.log*\n.env\n.git\n*.md\ncoverage\ndist\n`;

const _envExample = (appName, port) =>
    `NODE_ENV=production\nPORT=${port}\nMONGO_URI=mongodb://localhost:27017/${appName}\nJWT_SECRET=change_me\nGROQ_API_KEY=\n`;

const _deployScript = (appName, port) => `#!/bin/bash
set -e
APP="${appName}"
echo "Deploying $APP..."
docker build -t $APP:latest .
docker stop $APP 2>/dev/null || true
docker rm   $APP 2>/dev/null || true
docker run -d --name $APP --env-file .env --restart unless-stopped \\
  -p ${port}:${port} $APP:latest
echo "$APP deployed"
docker ps | grep $APP
`;

async function run(task) {
    const p          = task.payload  || {};
    const appName    = p.appName     || p.name || "jarvis-app";
    const outputDir  = p.outputDir   || `./generated/deployment/${appName}`;
    const port       = p.port        || 3000;
    const nodeVer    = p.nodeVersion || "20";
    const withMongo  = !!p.mongo;

    const files = [
        ["Dockerfile",         _dockerfile(port, nodeVer)],
        ["docker-compose.yml", _compose(appName, port, withMongo)],
        [".dockerignore",      _dockerignore()],
        [".env.example",       _envExample(appName, port)],
        ["deploy.sh",          _deployScript(appName, port)]
    ];

    const written = [];
    for (const [name, content] of files) {
        await fsUtil.writeFile(path.join(outputDir, name), content);
        written.push(name);
    }

    return {
        success: true,
        appName,
        outputDir,
        files:    written,
        commands: {
            build:  `docker build -t ${appName}:latest .`,
            up:     `docker-compose up -d`,
            logs:   `docker-compose logs -f ${appName}`,
            deploy: `bash deploy.sh`
        }
    };
}

module.exports = { run };
