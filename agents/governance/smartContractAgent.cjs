"use strict";
const crypto = require("crypto");
const { load, flush, uid, NOW, govAudit, ok, fail, blocked, GOV_DISCLAIMER } = require("./_governanceStore.cjs");
const AGENT = "smartContractAgent";

const CONTRACT_TEMPLATES = {
    token_erc20: {
        name:     "ERC-20 Token",
        language: "Solidity ^0.8.0",
        uses:     ["Fungible token", "Governance token", "Utility token"],
        risks:    ["Reentrancy if custom hooks added", "Integer overflow if unchecked", "Access control — ensure onlyOwner on mint/burn"],
        template: `// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;\nimport "@openzeppelin/contracts/token/ERC20/ERC20.sol";\nimport "@openzeppelin/contracts/access/Ownable.sol";\ncontract {{name}} is ERC20, Ownable {\n    constructor(uint256 initialSupply) ERC20("{{name}}", "{{symbol}}") {\n        _mint(msg.sender, initialSupply * 10 ** decimals());\n    }\n    function mint(address to, uint256 amount) public onlyOwner { _mint(to, amount); }\n}`
    },
    nft_erc721: {
        name:     "ERC-721 NFT",
        language: "Solidity ^0.8.0",
        uses:     ["Digital art", "Membership NFT", "Credential NFT"],
        risks:    ["Token URI should point to decentralised storage (IPFS, not centralised server)", "Royalty enforcement varies by marketplace"],
        template: `// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;\nimport "@openzeppelin/contracts/token/ERC721/ERC721.sol";\nimport "@openzeppelin/contracts/access/Ownable.sol";\ncontract {{name}} is ERC721, Ownable {\n    uint256 private _tokenIds;\n    constructor() ERC721("{{name}}", "{{symbol}}") {}\n    function mintNFT(address recipient, string memory tokenURI) public onlyOwner returns (uint256) {\n        _tokenIds++;\n        _mint(recipient, _tokenIds);\n        return _tokenIds;\n    }\n}`
    },
    multisig: {
        name:     "MultiSig Wallet",
        language: "Solidity ^0.8.0",
        uses:     ["DAO treasury", "Team funds", "Escrow"],
        risks:    ["Key loss risk — use hardware wallets", "Ensure m-of-n threshold is appropriate", "Time-lock recommended for large withdrawals"],
        template: `// Simplified MultiSig — use Gnosis Safe for production\n// Requires {{threshold}} of {{signers}} signers\n// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;\ncontract MultiSig {\n    address[] public owners;\n    uint public required;\n    // Full implementation: https://github.com/gnosis/safe-contracts\n}`
    },
    vesting: {
        name:     "Token Vesting",
        language: "Solidity ^0.8.0",
        uses:     ["Team token vesting", "Investor lock-up", "Grant schedule"],
        risks:    ["Cliff and duration must be set correctly before deployment", "Revocation logic must be carefully audited"],
        template: `// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;\nimport "@openzeppelin/contracts/finance/VestingWallet.sol";\n// VestingWallet(beneficiary, startTimestamp, durationSeconds)\n// Cliff via custom override — see OpenZeppelin docs`
    }
};

const SECURITY_CHECKS = [
    { id:"SC001", name:"Reentrancy",         description:"Check for state changes after external calls", severity:"CRITICAL" },
    { id:"SC002", name:"Integer Overflow",    description:"Ensure SafeMath or Solidity >=0.8 (auto-checks)", severity:"HIGH" },
    { id:"SC003", name:"Access Control",      description:"All privileged functions must use onlyOwner or role guards", severity:"CRITICAL" },
    { id:"SC004", name:"Front-Running",       description:"Commit-reveal scheme or time-lock for sensitive state changes", severity:"MEDIUM" },
    { id:"SC005", name:"Oracle Manipulation", description:"Use TWAP not spot price for on-chain pricing", severity:"HIGH" },
    { id:"SC006", name:"Unchecked Returns",   description:"Always check return values from external calls", severity:"MEDIUM" },
    { id:"SC007", name:"Self-Destruct",       description:"Avoid selfdestruct — permanently removes contract", severity:"HIGH" },
    { id:"SC008", name:"Timestamp Dependence",description:"Do not rely on block.timestamp for randomness", severity:"MEDIUM" }
];

function getTemplate({ userId, templateKey }) {
    if (!userId) return fail(AGENT, "userId required");
    if (!templateKey) return ok(AGENT, { templates: Object.entries(CONTRACT_TEMPLATES).map(([k,v]) => ({ key:k, name:v.name, uses:v.uses })), disclaimer:GOV_DISCLAIMER });

    const tmpl = CONTRACT_TEMPLATES[templateKey];
    if (!tmpl) return fail(AGENT, `Unknown template. Valid: ${Object.keys(CONTRACT_TEMPLATES).join(", ")}`);

    govAudit(AGENT, userId, "template_accessed", { templateKey }, "INFO");
    return ok(AGENT, {
        key:         templateKey,
        name:        tmpl.name,
        language:    tmpl.language,
        uses:        tmpl.uses,
        risks:       tmpl.risks,
        template:    tmpl.template,
        auditNote:   "Always have smart contracts audited by a professional firm (e.g., OpenZeppelin, CertiK, Trail of Bits) before mainnet deployment",
        disclaimer:  GOV_DISCLAIMER
    });
}

function auditContract({ userId, contractCode, contractName }) {
    if (!userId || !contractCode) return fail(AGENT, "userId and contractCode required");

    const findings = [];
    const code = contractCode.toLowerCase();

    if (/\.call\(/.test(code) && !/mutex|nonreentrant|guard/.test(code))
        findings.push({ ...SECURITY_CHECKS[0], found:true, suggestion:"Add ReentrancyGuard from OpenZeppelin" });

    if (/pragma solidity\s+\^?0\.[0-7]\./.test(code))
        findings.push({ ...SECURITY_CHECKS[1], found:true, suggestion:"Upgrade to Solidity >=0.8 for built-in overflow protection" });

    if (!/onlyowner|hasrole|modifier/.test(code) && /function.*public/.test(code))
        findings.push({ ...SECURITY_CHECKS[2], found:true, suggestion:"Add access control modifiers to public state-changing functions" });

    if (/block\.timestamp/.test(code))
        findings.push({ ...SECURITY_CHECKS[7], found:true, suggestion:"Do not use block.timestamp for randomness or critical timing" });

    if (/selfdestruct/.test(code))
        findings.push({ ...SECURITY_CHECKS[6], found:true, suggestion:"Remove selfdestruct — use upgrade proxy patterns instead" });

    const criticals = findings.filter(f => f.severity === "CRITICAL");
    const riskLevel = criticals.length ? "CRITICAL" : findings.length >= 3 ? "HIGH" : findings.length ? "MEDIUM" : "LOW";

    const auditId = uid("aud");
    govAudit(AGENT, userId, "contract_audited", { auditId, contractName, riskLevel, findingCount:findings.length }, riskLevel === "CRITICAL" || riskLevel === "HIGH" ? "HIGH" : "INFO");

    if (criticals.length) {
        return blocked(AGENT, `Critical vulnerabilities found in "${contractName || "contract"}": ${criticals.map(f=>f.name).join(", ")}. DO NOT deploy until fixed.`, "CRITICAL");
    }

    return ok(AGENT, {
        auditId,
        contractName:   contractName || "Unnamed Contract",
        riskLevel,
        findingCount:   findings.length,
        findings,
        passedChecks:   SECURITY_CHECKS.length - findings.length,
        professionalAuditRequired: findings.length > 0,
        disclaimer:     GOV_DISCLAIMER,
        note:           "This is an automated static analysis only — NOT a professional security audit. Engage a certified auditor before mainnet deployment."
    });
}

function simulateDeploy({ userId, contractName, network = "ethereum", constructorArgs = {}, gasEstimate }) {
    if (!userId || !contractName) return fail(AGENT, "userId and contractName required");

    const supportedNets = ["ethereum","polygon","solana","goerli","sepolia","mumbai"];
    if (!supportedNets.includes(network)) return fail(AGENT, `network must be: ${supportedNets.join(", ")}`);

    const simAddress = "0x" + crypto.randomBytes(20).toString("hex");
    const simTxHash  = "0x" + crypto.randomBytes(32).toString("hex");
    const gasUsed    = gasEstimate || Math.floor(800000 + Math.random() * 400000);

    const deployRecord = {
        id:           uid("dep"),
        contractName,
        network,
        simulatedAddress: simAddress,
        simulatedTxHash:  simTxHash,
        gasUsed,
        constructorArgs,
        deployedAt:   NOW(),
        deployedBy:   userId,
        status:       "SIMULATED"
    };

    const history = load(userId, "deploy_history", []);
    history.push(deployRecord);
    flush(userId, "deploy_history", history.slice(-500));

    govAudit(AGENT, userId, "contract_deploy_simulated", { deployId:deployRecord.id, contractName, network }, "HIGH");

    return ok(AGENT, {
        ...deployRecord,
        note:       "⚠️ SIMULATION MODE — no real contract was deployed on any blockchain",
        disclaimer: GOV_DISCLAIMER
    });
}

function getSecurityChecklist() {
    return ok(AGENT, { checks: SECURITY_CHECKS, totalChecks: SECURITY_CHECKS.length, disclaimer: GOV_DISCLAIMER, recommendedAuditors: ["OpenZeppelin", "CertiK", "Trail of Bits", "Quantstamp", "Halborn"] });
}

module.exports = { getTemplate, auditContract, simulateDeploy, getSecurityChecklist };
