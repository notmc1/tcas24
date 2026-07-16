const canvas = document.getElementById("tcasCanvas");
const ctx = canvas.getContext("2d");
const connectBtn = document.getElementById("connectBtn");

const pilotSelect = document.getElementById("pilotSelect");
const debugPanel = document.getElementById("debugPanel");
const alertBanner = document.getElementById("alertBanner");

const rawStream = document.getElementById("rawStream");
const procStream = document.getElementById("procStream");

let ws = null;
let liveTraffic = {};
let zoomFactor = 0.015;
let viewHeading = 0;
let showInfo = false;
let showGround = false;
let debugVisible = false;
let ownshipCallsign = null;

let lastAltitudes = {};
let lastThreats = {};

const studsPerNm = 3307.14286;

function speakAlert(text) {
    speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}

function resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(1,0,0,1,0,0);
    ctx.scale(dpr,dpr);
}
resize();
window.addEventListener("resize", resize);

connectBtn.onclick = () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
        connectBtn.textContent = "Connect";
        connectBtn.classList.remove("connected");
        return;
    }
   // speakAlert("Connected to 24 Data.");
    ws = new WebSocket("https://tcas24.onrender.com");

    ws.onopen = () => {
        connectBtn.textContent = "Disconnect";
        connectBtn.classList.add("connected");
    };

    ws.onclose = () => {
        connectBtn.textContent = "Connect";
        connectBtn.classList.remove("connected");
    };

    ws.onmessage = async (msg) => {
        let text = msg.data instanceof Blob ? await msg.data.text() : msg.data;
        rawStream.textContent = text;

        let incoming;
        try {
            incoming = JSON.parse(text);
        } catch {
            procStream.textContent = "JSON parse error";
            return;
        }

       
        if (!incoming.d || Object.keys(incoming.d).length === 0) {
            return;
        }

        liveTraffic = incoming;

      
        if (!ownshipCallsign) {
            populatePilotDropdown();
        }
    };
};

function populatePilotDropdown() {
    if (!liveTraffic.d) return;

    pilotSelect.innerHTML = `<option value="">Select your aircraft</option>`;

    for (const callsign in liveTraffic.d) {
        const ac = liveTraffic.d[callsign];
        if (!ac.playerName) continue;

        const opt = document.createElement("option");
        opt.value = callsign;
        opt.textContent = ac.playerName + " (" + callsign + ")";
        pilotSelect.appendChild(opt);
    }
}

pilotSelect.onchange = () => {
    ownshipCallsign = pilotSelect.value || null;
};

canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    zoomFactor *= (e.deltaY > 0 ? 1.1 : 0.9);
    zoomFactor = Math.max(0.001, Math.min(zoomFactor, 0.2));
});

window.addEventListener("keydown", e => {
    if (e.key.toLowerCase() === "i") showInfo = !showInfo;
    if (e.key.toLowerCase() === "g") showGround = !showGround;
    if (e.key.toLowerCase() === "x") {
        debugVisible = !debugVisible;
        debugPanel.style.display = debugVisible ? "block" : "none";
    }
});

function drawOwnship(cx, cy) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = "#ffff00";
    ctx.lineWidth = 2;

    ctx.beginPath();
    
    ctx.moveTo(0, -22);
    ctx.lineTo(0, 15);

  
    ctx.moveTo(-18, -4);
    ctx.lineTo(18, -4);

    
    ctx.moveTo(-10, 10);
    ctx.lineTo(10, 10);

    ctx.stroke();
    ctx.restore();
}

function drawRangeArcs(cx, cy, width) {
    ctx.save();
    ctx.strokeStyle = "#444";
    ctx.setLineDash([6,6]);
    ctx.lineWidth = 1.2;

    const r3  = (3  * studsPerNm) * zoomFactor;
    const r6  = (6  * studsPerNm) * zoomFactor;
    const r12 = (12 * studsPerNm) * zoomFactor;

    ctx.beginPath();
    ctx.arc(cx, cy, r3, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, r6, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, r12, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();

    ctx.fillStyle = "#666";
    ctx.font = "bold 13px Arial";
    ctx.textAlign = "center";

    ctx.fillText("3",  cx - r3  * 0.75,  cy - r3  * 0.75);
    ctx.fillText("6",  cx - r6  * 0.75,  cy - r6  * 0.75);
    ctx.fillText("12", cx - r12 * 0.75,  cy - r12 * 0.75);

    ctx.restore();
}

function drawHeadingTape(cx, cy, width) {
    ctx.save();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;

    const rArc = width * 0.50;

    ctx.beginPath();
    ctx.arc(cx, cy, rArc, Math.PI * 1.14, Math.PI * 1.86);
    ctx.stroke();

    for (let hdg = 0; hdg < 360; hdg += 10) {
        let rel = ((hdg - viewHeading + 540) % 360) - 180;
        if (rel < -60 || rel > 60) continue;

        const rad = (rel - 90) * Math.PI / 180;
        const tx = cx + Math.cos(rad) * (rArc + 20);
        const ty = cy + Math.sin(rad) * (rArc + 20);

        ctx.fillStyle = "#fff";
        ctx.font = "14px Arial";
        ctx.textAlign = "center";
        ctx.fillText(hdg.toString().padStart(3, "0"), tx, ty);
    }

    ctx.restore();
}

function classifyThreat(distNm, altDiff, isOnGround) {
    if (isOnGround) return "NONE";

    if (distNm < 3 && Math.abs(altDiff) < 600) return "RA";
    if (distNm < 6 && Math.abs(altDiff) < 850) return "TA";
    if (distNm < 6 && Math.abs(altDiff) < 1200) return "PROX";

    return "NONE";
}

function drawTraffic(cx, cy) {
    const processed = {};

    if (!liveTraffic.d) {
        procStream.textContent = "{}";
        return;
    }

    if (!ownshipCallsign || !liveTraffic.d[ownshipCallsign]) {
        alertBanner.textContent = "";
        procStream.textContent = "{}";
        return;
    }

    let ownX = liveTraffic.d[ownshipCallsign].position.x;
    let ownY = liveTraffic.d[ownshipCallsign].position.y;
    let ownAlt = liveTraffic.d[ownshipCallsign].altitude || 0;

    alertBanner.textContent = "";

    for (const callsign in liveTraffic.d) {
        const ac = liveTraffic.d[callsign];
        if (!ac.position) continue;

        if (callsign === ownshipCallsign) continue;
        if (ac.isOnGround === true && !showGround) continue;

        const relX = ac.position.x - ownX;
        const relY = ac.position.y - ownY;

        const distStuds = Math.sqrt(relX * relX + relY * relY);
        const distNm = distStuds / studsPerNm;

        const altFt = ac.altitude || 0;
        const altDiff = altFt - ownAlt;
        const hundreds = Math.round(altDiff / 100);

        const rad = (-viewHeading) * Math.PI / 180;
        const rotX = relX * Math.cos(rad) - relY * Math.sin(rad);
        const rotY = relX * Math.sin(rad) + relY * Math.cos(rad);

        const px = cx + rotX * zoomFactor;
        const py = cy - rotY * zoomFactor;

        processed[callsign] = { relX, relY, px, py, distNm, altDiff };

        let vs = 0;
        if (lastAltitudes[callsign] !== undefined) {
            vs = altFt - lastAltitudes[callsign];
        }
        lastAltitudes[callsign] = altFt;

        let trend = "";
        if (vs > 30) trend = "▲";
        if (vs < -30) trend = "▼";

        const threat = classifyThreat(distNm, altDiff, ac.isOnGround === true);

        if (threat !== lastThreats[callsign]) {
            if (threat === "TA") {
                alertBanner.textContent = "TRAFFIC";
                speakAlert("Traffic");
            }
            if (threat === "RA") {
                if (vs > 0) {
                    alertBanner.textContent = "CLIMB";
                    speakAlert("Climb");
                } else {
                    alertBanner.textContent = "DESCEND";
                    speakAlert("Descend");
                }
            }
        }
        lastThreats[callsign] = threat;

        let stroke = "#fff";
        let fill = "transparent";

        if (threat === "PROX") {
            stroke = "#ffffff";
            fill = "#ffffff";
        } else if (threat === "TA") {
            stroke = "#ffff00";
            fill = "#ffff00";
        } else if (threat === "RA") {
            stroke = "#ff0000";
            fill = "#ff0000";
        }

        ctx.save();
        ctx.strokeStyle = stroke;
        ctx.fillStyle = fill;
        ctx.lineWidth = 2;

        const size = 12;

        ctx.beginPath();
        if (threat === "NONE" || threat === "PROX") {
            ctx.moveTo(px, py - size);
            ctx.lineTo(px + size, py);
            ctx.lineTo(px, py + size);
            ctx.lineTo(px - size, py);
            ctx.closePath();
        } else if (threat === "TA") {
            ctx.arc(px, py, size, 0, Math.PI * 2);
        } else if (threat === "RA") {
            ctx.moveTo(px, py - size);
            ctx.lineTo(px + size, py);
            ctx.lineTo(px, py + size);
            ctx.lineTo(px - size, py);
            ctx.closePath();
        }
        ctx.stroke();
        if (fill !== "transparent") ctx.fill();

        ctx.fillStyle = "#fff";
        ctx.font = "bold 13px Arial";
        ctx.textAlign = "center";
        const altText = (hundreds > 0 ? "+" : "") + hundreds + (trend ? " " + trend : "");
        ctx.fillText(altText, px, py + size * 2.2);

        if (showInfo) {
            ctx.font = "11px Arial";
            ctx.fillStyle = "#ccc";
            ctx.textAlign = "left";

            const gs = Math.round(ac.groundSpeed || ac.speed || 0);

            ctx.fillText(`${callsign}`, px + size * 1.4, py - size * 1.2);
            ctx.fillText(`${ac.aircraftType}`, px + size * 1.4, py - size * 0.2);
            ctx.fillText(`ALT ${altFt} ft`, px + size * 1.4, py + size * 0.8);
            ctx.fillText(`SPD ${gs} kt`, px + size * 1.4, py + size * 1.8);
            ctx.fillText(`PILOT ${ac.playerName}`, px + size * 1.4, py + size * 2.8);
        }

        ctx.restore();
    }

    procStream.textContent = JSON.stringify(processed, null, 2);
}

function draw() {
    const width = canvas.width / (window.devicePixelRatio || 1);
    const height = canvas.height / (window.devicePixelRatio || 1);
    const cx = width / 2;
    const cy = height * 0.65;

    ctx.clearRect(0,0,width,height);

    drawRangeArcs(cx, cy, width);
    drawHeadingTape(cx, cy, width);
    drawOwnship(cx, cy);
    drawTraffic(cx, cy);

    requestAnimationFrame(draw);
}
draw();

window.addEventListener("keydown", e => {
    if (e.key === "a") viewHeading = (viewHeading - 5 + 360) % 360;
    if (e.key === "d") viewHeading = (viewHeading + 5) % 360;
});
