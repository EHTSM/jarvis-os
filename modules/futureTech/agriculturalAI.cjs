"use strict";
const { load, flush, loadUser, flushUser, ftLog, uid, NOW, simValue, simConfidence, ok, fail } = require("./_futureTechStore.cjs");

const AGENT = "agriculturalAI";

const CROP_TYPES       = ["wheat","maize","rice","soybean","cotton","sugarcane","potato","tomato","sunflower","barley","sorghum","canola"];
const FARMING_SYSTEMS  = ["conventional","organic","regenerative","precision","hydroponic","aquaponic","vertical","agroforestry","mixed"];
const IRRIGATION_TYPES = ["drip","sprinkler","flood","subsurface","rainwater_harvesting","deficit_irrigation"];
const PEST_TYPES       = ["aphids","locusts","whitefly","armyworm","boll_weevil","nematode","fusarium","powdery_mildew","rust","blight"];
const SOIL_AMENDMENTS  = ["compost","lime","gypsum","biochar","rock_phosphate","green_manure","mycorrhizae","vermicompost"];

function getCropRecommendation({ userId, farmId, soilType, climate, cropHistory = [], season, waterAvailability_mm }) {
    if (!userId) return fail(AGENT, "userId required");
    const SEASONS = ["spring","summer","autumn","winter","monsoon","dry"];
    if (season && !SEASONS.includes(season)) return fail(AGENT, `season must be: ${SEASONS.join(", ")}`);

    const recommendations = CROP_TYPES.slice(0, 5).map(crop => ({
        crop,
        suitabilityScore:    Math.round(simValue(40, 99, 0)),
        expectedYield_t_ha:  parseFloat(simValue(1, 15, 2)),
        waterRequired_mm:    Math.round(simValue(200, 1500, 0)),
        growthDays:          Math.round(simValue(60, 180, 0)),
        profitability_USD_ha: parseFloat(simValue(200, 5000, 2)),
        riskLevel:           ["low","moderate","high"][Math.floor(Math.random()*3)],
        bestVariety:         `${crop}_variety_${Math.floor(Math.random()*10)+1}`,
        intercropOptions:    CROP_TYPES.filter(c => c !== crop).slice(0, 2)
    })).sort((a, b) => b.suitabilityScore - a.suitabilityScore);

    const rec = {
        recommendationId: uid("crec"),
        farmId:           farmId || `farm_${uid("f")}`,
        soilType:         soilType || "loamy",
        climate:          climate || "temperate",
        season:           season || "spring",
        waterAvailability_mm: waterAvailability_mm || Math.round(simValue(200, 1200, 0)),
        cropHistory,
        recommendations,
        topChoice:        recommendations[0].crop,
        confidence:       simConfidence(),
        generatedAt:      NOW()
    };

    const history = loadUser(userId, "crop_recommendations", []);
    history.push({ recommendationId: rec.recommendationId, farmId, topChoice: rec.topChoice, generatedAt: rec.generatedAt });
    flushUser(userId, "crop_recommendations", history.slice(-200));

    ftLog(AGENT, userId, "crop_recommended", { farmId, topChoice: rec.topChoice, season }, "INFO");
    return ok(AGENT, rec);
}

function monitorCropHealth({ userId, farmId, cropType, fieldId, imagingSource = "satellite" }) {
    if (!userId) return fail(AGENT, "userId required");
    if (cropType && !CROP_TYPES.includes(cropType)) return fail(AGENT, `cropType must be: ${CROP_TYPES.join(", ")}`);

    const IMAGING_SOURCES = ["satellite","drone","ground_sensor","mobile_app"];
    if (!IMAGING_SOURCES.includes(imagingSource)) return fail(AGENT, `imagingSource must be: ${IMAGING_SOURCES.join(", ")}`);

    const pests = Math.random() > 0.5 ? PEST_TYPES.slice(0, Math.floor(Math.random()*3)+1) : [];
    const health = {
        monitoringId:     uid("ch"),
        farmId:           farmId || `farm_${uid("f")}`,
        fieldId:          fieldId || `field_${uid("fi")}`,
        cropType:         cropType || CROP_TYPES[Math.floor(Math.random() * CROP_TYPES.length)],
        imagingSource,
        ndvi:             parseFloat(simValue(0.1, 0.9, 3)),
        ndwi:             parseFloat(simValue(-0.5, 0.8, 3)),
        leafAreaIndex:    parseFloat(simValue(0.5, 6, 2)),
        chlorophyllIndex: parseFloat(simValue(20, 80, 1)),
        stressLevel:      ["none","mild","moderate","severe"][Math.floor(Math.random()*4)],
        detectedPests:    pests,
        diseaseRisk_pct:  parseFloat(simValue(0, 60, 1)),
        waterStress:      Math.random() > 0.6,
        nutrientDeficiency: Math.random() > 0.7 ? ["nitrogen","phosphorus","potassium"].slice(0, Math.floor(Math.random()*2)+1) : [],
        yieldForecast_t_ha: parseFloat(simValue(1, 15, 2)),
        actionRequired:   pests.length > 0 || Math.random() > 0.6,
        confidence:       simConfidence(),
        monitoredAt:      NOW()
    };

    ftLog(AGENT, userId, "crop_health_monitored", { farmId, cropType, stressLevel: health.stressLevel }, "INFO");
    return ok(AGENT, health);
}

function optimiseIrrigation({ userId, farmId, cropType, soilMoisture_pct, irrigationType = "drip", weatherForecast = {} }) {
    if (!userId) return fail(AGENT, "userId required");
    if (!IRRIGATION_TYPES.includes(irrigationType)) return fail(AGENT, `irrigationType must be: ${IRRIGATION_TYPES.join(", ")}`);

    const soilMoist = soilMoisture_pct || parseFloat(simValue(10, 80, 1));
    const schedule = Array.from({ length: 7 }, (_, i) => ({
        day:           `day_${i+1}`,
        irrigate:      soilMoist < 40 || Math.random() > 0.6,
        amount_mm:     parseFloat(simValue(0, 30, 1)),
        startTime:     `0${Math.floor(Math.random()*3)+5}:00`,
        duration_min:  Math.round(simValue(15, 120, 0)),
        expectedSoilMoisture_pct: parseFloat(simValue(30, 80, 1))
    }));

    const optimisation = {
        optimisationId:      uid("irr"),
        farmId:              farmId || `farm_${uid("f")}`,
        cropType:            cropType || "wheat",
        irrigationType,
        currentSoilMoisture_pct: soilMoist,
        fieldCapacity_pct:   parseFloat(simValue(50, 90, 1)),
        willingPoint_pct:    parseFloat(simValue(10, 30, 1)),
        weeklySchedule:      schedule,
        totalWaterSaving_pct: parseFloat(simValue(10, 45, 1)),
        etRate_mm_day:       parseFloat(simValue(1, 10, 2)),
        confidence:          simConfidence(),
        optimisedAt:         NOW()
    };

    ftLog(AGENT, userId, "irrigation_optimised", { farmId, irrigationType, totalWaterSaving_pct: optimisation.totalWaterSaving_pct }, "INFO");
    return ok(AGENT, optimisation);
}

function predictHarvest({ userId, farmId, cropType, plantingDate, fieldArea_ha, farmingSystem = "conventional" }) {
    if (!userId) return fail(AGENT, "userId required");
    if (!CROP_TYPES.includes(cropType)) return fail(AGENT, `cropType must be: ${CROP_TYPES.join(", ")}`);
    if (!FARMING_SYSTEMS.includes(farmingSystem)) return fail(AGENT, `farmingSystem must be: ${FARMING_SYSTEMS.join(", ")}`);

    const area = fieldArea_ha || parseFloat(simValue(1, 500, 1));
    const yieldPerHa = parseFloat(simValue(1, 15, 2));
    const totalYield = parseFloat((area * yieldPerHa).toFixed(2));

    const prediction = {
        predictionId:         uid("harv"),
        farmId:               farmId || `farm_${uid("f")}`,
        cropType,
        plantingDate:         plantingDate || NOW().slice(0, 10),
        harvestWindow: {
            earliest:         new Date(Date.now() + simValue(60,100,0)*86400000).toISOString().slice(0,10),
            optimal:          new Date(Date.now() + simValue(90,120,0)*86400000).toISOString().slice(0,10),
            latest:           new Date(Date.now() + simValue(130,180,0)*86400000).toISOString().slice(0,10)
        },
        fieldArea_ha:         area,
        farmingSystem,
        yieldPerHa_t:         yieldPerHa,
        totalYield_t:         totalYield,
        marketValue_USD:      parseFloat((totalYield * simValue(100, 1000, 2)).toFixed(2)),
        qualityGrade:         ["A","B","C","premium"][Math.floor(Math.random()*4)],
        weatherRisk_pct:      parseFloat(simValue(5, 40, 1)),
        pestRisk_pct:         parseFloat(simValue(5, 35, 1)),
        laborRequired_days:   Math.round(simValue(5, 60, 0)),
        confidence:           simConfidence(),
        predictedAt:          NOW()
    };

    ftLog(AGENT, userId, "harvest_predicted", { farmId, cropType, totalYield_t: totalYield }, "INFO");
    return ok(AGENT, prediction);
}

module.exports = { getCropRecommendation, monitorCropHealth, optimiseIrrigation, predictHarvest };
