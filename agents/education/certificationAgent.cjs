/**
 * Certification Agent — issues completion certificates with structured metadata.
 * Certificate data stored in JSON; PDF rendering requires external tool (jsPDF/puppeteer).
 */

const { load, flush, uid, NOW, logToMemory, ok, fail } = require("./_eduStore.cjs");

const STORE = "certificates";

const CERT_TYPES = {
    completion:  { title: "Certificate of Completion",  requirement: "Complete all modules" },
    proficiency: { title: "Certificate of Proficiency", requirement: "Score 70%+ on final exam" },
    mastery:     { title: "Certificate of Mastery",     requirement: "Score 90%+ on advanced exam" },
    participation: { title: "Certificate of Participation", requirement: "Attend / complete 50%+" }
};

function issue({ userId, name, course, score = 0, type = "completion", issuerName = "Jarvis AI Academy" }) {
    if (!userId || !name || !course) throw new Error("userId, name, and course required");

    const certType   = CERT_TYPES[type] || CERT_TYPES.completion;
    const certNumber = `CERT-${uid("").slice(0, 8).toUpperCase()}`;
    const issuedDate = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });

    const cert = {
        id:           uid("cert"),
        certNumber,
        userId,
        recipientName: name,
        course,
        type,
        certTitle:    certType.title,
        score:        score ? `${score}%` : null,
        grade:        score >= 90 ? "A+" : score >= 75 ? "A" : score >= 60 ? "B" : score >= 50 ? "C" : null,
        issuerName,
        issuedDate,
        validUntil:   "Lifetime",
        verificationUrl: `https://verify.jarvis.ai/${certNumber}`,
        metadata: {
            achievement:  `${certType.title} — ${course}`,
            skills:       [`${course} fundamentals`, `${course} application`, `${course} best practices`],
            verifyCode:   certNumber,
            format:       "PDF-ready JSON — render with jsPDF or puppeteer"
        },
        template: {
            header:    issuerName,
            body:      `This is to certify that ${name} has successfully ${certType.requirement.toLowerCase()} for the course "${course}".`,
            footer:    `Issued on ${issuedDate}. Certificate No: ${certNumber}`,
            signature: issuerName,
            seal:      "🎓 Verified by Jarvis AI"
        },
        createdAt: NOW()
    };

    const all = load(STORE, []);
    all.push(cert);
    flush(STORE, all);
    logToMemory("certificationAgent", `${name}: ${course}`, { certNumber, type });

    return cert;
}

function verify(certNumber) {
    const cert = load(STORE, []).find(c => c.certNumber === certNumber);
    return cert ? { valid: true, cert } : { valid: false, message: "Certificate not found" };
}

function getUserCerts(userId) {
    return load(STORE, []).filter(c => c.userId === userId);
}

async function run(task) {
    const p = task.payload || {};
    try {
        let data;
        if (task.type === "verify_cert") {
            data = verify(p.certNumber);
        } else if (task.type === "user_certs") {
            data = { certificates: getUserCerts(p.userId) };
        } else {
            data = issue({ userId: p.userId || "user-1", name: p.name || "Student", course: p.course || p.topic || task.input || "Course", score: p.score || 0, type: p.type || "completion", issuerName: p.issuer || "Jarvis AI Academy" });
        }
        return ok("certificationAgent", data, ["Share your certificate on LinkedIn", "Start the next level course"]);
    } catch (err) { return fail("certificationAgent", err.message); }
}

module.exports = { issue, verify, getUserCerts, run };
