"use strict";
/**
 * Health Risk Predictor — general lifestyle-based risk scoring.
 * SAFE logic only: no medical diagnosis. Educational risk factors only.
 */
const { load, flush, uid, NOW, ok, fail, accessLog, RISK } = require("./_healthStore.cjs");

const AGENT = "healthRiskPredictor";

function _bmiCategory(bmi) {
    if (bmi < 18.5) return { cat: "Underweight",   risk: 1 };
    if (bmi < 25)   return { cat: "Normal weight",  risk: 0 };
    if (bmi < 30)   return { cat: "Overweight",     risk: 1 };
    if (bmi < 35)   return { cat: "Obese Class I",  risk: 2 };
    return              { cat: "Obese Class II+",   risk: 3 };
}

function _ageRisk(age) {
    if (age < 30)  return 0;
    if (age < 45)  return 1;
    if (age < 60)  return 2;
    return 3;
}

function assessRisk({ userId, age, gender, heightCm, weightKg, systolicBP, diastolicBP,
    smoker = false, alcoholUnitsPerWeek = 0, exerciseDaysPerWeek = 0,
    diabetes = false, hypertension = false, familyHeartDisease = false,
    familyCancer = false, stressLevel = "low" }) {

    if (!userId) return fail(AGENT, "userId required");
    if (!age)    return fail(AGENT, "age required");

    accessLog(userId, AGENT, "risk_assessed");

    let score = 0;
    const factors = [];
    const advice  = [];

    // BMI
    let bmiInfo = null;
    if (heightCm && weightKg) {
        const bmi = weightKg / Math.pow(heightCm / 100, 2);
        bmiInfo   = { bmi: +bmi.toFixed(1), ...(_bmiCategory(bmi)) };
        score    += bmiInfo.risk;
        if (bmiInfo.risk > 0) {
            factors.push(`BMI ${bmiInfo.bmi} — ${bmiInfo.cat}`);
            advice.push("Work with a nutritionist to achieve a healthy BMI through balanced diet and exercise.");
        }
    }

    // Age
    const ageRisk = _ageRisk(age);
    score += ageRisk;
    if (ageRisk > 1) factors.push(`Age ${age} — increased baseline risk`);

    // Smoking
    if (smoker) {
        score += 3;
        factors.push("Smoking — significant cardiovascular and cancer risk");
        advice.push("Quitting smoking is the single most impactful change for long-term health. Seek support from a doctor.");
    }

    // Alcohol
    if (alcoholUnitsPerWeek > 14) { score += 2; factors.push("Heavy alcohol consumption (>14 units/week)"); advice.push("Reduce alcohol to below 14 units/week. Consult doctor if struggling to cut down."); }
    else if (alcoholUnitsPerWeek > 7) { score += 1; factors.push("Moderate alcohol consumption"); }

    // Exercise
    if (exerciseDaysPerWeek === 0)  { score += 2; factors.push("No regular exercise"); advice.push("Aim for 150 minutes of moderate exercise per week (e.g., 30 min brisk walk 5x/week)."); }
    else if (exerciseDaysPerWeek < 3) { score += 1; factors.push("Low exercise frequency"); }

    // Blood pressure
    if (systolicBP > 140 || diastolicBP > 90) { score += 2; factors.push(`Elevated blood pressure (${systolicBP}/${diastolicBP})`); advice.push("Monitor blood pressure regularly. Consult a doctor about management."); }
    else if (systolicBP > 130) { score += 1; factors.push("Borderline elevated blood pressure"); }

    // Medical conditions
    if (diabetes)          { score += 2; factors.push("Existing diabetes"); advice.push("Regular HbA1c monitoring and diabetes management with your doctor is essential."); }
    if (hypertension)      { score += 2; factors.push("Existing hypertension"); }
    if (familyHeartDisease){ score += 1; factors.push("Family history of heart disease"); advice.push("Cardiology screening recommended from age 40 given family history."); }
    if (familyCancer)      { score += 1; factors.push("Family history of cancer"); advice.push("Discuss genetic screening and regular cancer screening with your doctor."); }

    // Stress
    if (stressLevel === "high")   { score += 1; factors.push("High chronic stress"); advice.push("Stress management through mindfulness, exercise, or therapy can significantly reduce health risks."); }
    else if (stressLevel === "severe") { score += 2; factors.push("Severe chronic stress"); }

    const riskLevel = score >= 10 ? RISK.HIGH : score >= 5 ? RISK.MEDIUM : RISK.LOW;
    const riskLabel = riskLevel === RISK.HIGH ? "High risk — discuss with your doctor urgently"
                    : riskLevel === RISK.MEDIUM ? "Moderate risk — schedule a check-up"
                    : "Low risk — maintain healthy habits";

    // Recommended screenings based on age/gender/risk
    const screenings = [];
    if (age >= 40) screenings.push("Annual blood pressure and cholesterol check");
    if (age >= 45) screenings.push("Blood sugar / HbA1c screening for diabetes");
    if (age >= 50) screenings.push("Colorectal cancer screening");
    if (gender === "female" && age >= 40) screenings.push("Mammogram (breast cancer screening)");
    if (gender === "female" && age >= 25) screenings.push("Cervical smear (Pap test) every 3 years");
    if (gender === "male"   && age >= 50) screenings.push("Prostate health discussion with GP");
    if (smoker || age >= 55) screenings.push("Lung health assessment");

    const assessment = {
        id:           uid("rsk"),
        userId,
        riskScore:    score,
        riskLevel,
        riskLabel,
        bmi:          bmiInfo,
        riskFactors:  factors,
        advice,
        recommendedScreenings: screenings,
        assessedAt:   NOW()
    };

    const hist = load(userId, "risk_assessments", []);
    hist.push(assessment);
    flush(userId, "risk_assessments", hist.slice(-50));

    return ok(AGENT, assessment, { riskLevel });
}

function getRiskHistory({ userId, limit = 10 }) {
    if (!userId) return fail(AGENT, "userId required");
    accessLog(userId, AGENT, "risk_history_viewed");
    return ok(AGENT, load(userId, "risk_assessments", []).slice(-limit).reverse());
}

module.exports = { assessRisk, getRiskHistory };
