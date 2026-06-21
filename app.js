// ===== CONFIG =====
const SHEET_ID = "1BZBPQOmfCC47ocsTI-UztH4hj3_CFxyQatC79vw-BHE";
const SHEET_NAME = "Compile"; // tab name
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_NAME)}`;

// FTE divisor rule based on shift
function getShiftMinutes(shift) {
  if (!shift) return 480;
  const s = String(shift).trim().toLowerCase();
  if (s === "day" || s === "night") return 720;
  return 480; // A, B, C, G, a, b, c
}

let RAW = [];
let FILTERS = { section: "All", shift: "All", phase: null };
let chart1, chart2;

// ===== LOAD =====
async function loadData() {
  const res = await fetch(CSV_URL + "&t=" + Date.now());
  const text = await res.text();
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
  RAW = parsed.data.map(r => ({
    sbu: r["SBU"]?.trim(),
    section: r["Section"]?.trim(),
    shift: r["Shift"]?.trim(),
    employee: r["Employee Name"]?.trim(),
    role: r["Role"]?.trim(),
    enroll: r["Employee Enroll"]?.trim(),
    workCentre: r["Work Centre"]?.trim(),
    task: r["Task List"]?.trim(),
    timePerTask: parseFloat(r["Time required /task"]) || 0,
    frequency: parseFloat(r["Frequency"]) || 0,
    actualTime: parseFloat(r["Actual Time/Shift"]) || 0,
    remarks: r["Remarks"]?.trim(),
    phase: r["Phase Remarks"]?.trim()
  })).filter(r => r.employee && r.role);
  render();
}

// ===== FILTERING =====
function applyFilters() {
  return RAW.filter(r => {
    if (FILTERS.section !== "All" && r.section !== FILTERS.section) return false;
    if (FILTERS.shift !== "All" && r.shift !== FILTERS.shift) return false;
    if (FILTERS.phase && r.phase !== FILTERS.phase) return false;
    return true;
  });
}

// ===== RENDER =====
function render() {
  renderFilters();
  const data = applyFilters();
  renderKPIs(data);
  renderCharts(data);
  renderRoleTable(data);
  renderAlerts(data);
  renderEmployees(data);
  document.getElementById("meta").innerHTML =
    `✅ Last updated: ${new Date().toLocaleString()} · ${RAW.length} task rows · ${new Set(RAW.map(r=>r.enroll)).size} unique employees · ${new Set(RAW.map(r=>r.section)).size} sections`;
}

function renderFilters() {
  const sections = [...new Set(RAW.map(r => r.section).filter(Boolean))].sort();
  const shifts = [...new Set(RAW.map(r => r.shift).filter(Boolean))].sort();
  const phases = [...new Set(RAW.map(r => r.phase).filter(Boolean))].sort();

  const buildChips = (id, items, key) => {
    const el = document.getElementById(id);
    el.innerHTML = "";
    const all = document.createElement("button");
    all.className = "chip" + (FILTERS[key] === "All" || (!FILTERS[key] && key === "phase") ? " active" : "");
    all.textContent = `All (${RAW.length})`;
    all.onclick = () => { FILTERS[key] = key === "phase" ? null : "All"; render(); };
    el.appendChild(all);
    items.forEach(v => {
      const c = document.createElement("button");
      const count = RAW.filter(r => r[key === "phase" ? "phase" : key] === v).length;
      c.className = "chip" + (FILTERS[key] === v ? " active" : "");
      c.textContent = `${v} (${count})`;
      c.onclick = () => { FILTERS[key] = v; render(); };
      el.appendChild(c);
    });
  };
  buildChips("sectionFilters", sections, "section");
  buildChips("shiftFilters", shifts, "shift");
  buildChips("phaseFilters", phases, "phase");
}

// ===== KPIs =====
function renderKPIs(data) {
  const empMap = {}; // key: enroll+shift -> total minutes
  data.forEach(r => {
    const k = r.enroll + "|" + r.shift;
    if (!empMap[k]) empMap[k] = { mins: 0, shift: r.shift, section: r.section, role: r.role, name: r.employee, phase: r.phase };
    empMap[k].mins += r.actualTime || (r.timePerTask * r.frequency);
  });

  // Role-level aggregation
  const roleMap = {};
  Object.values(empMap).forEach(e => {
    const k = e.role + "|" + e.section;
    if (!roleMap[k]) roleMap[k] = { role: e.role, section: e.section, totalFTE: 0, hc: 0, phase: e.phase };
    roleMap[k].totalFTE += e.mins / getShiftMinutes(e.shift);
    roleMap[k].hc++;
  });

  let overloaded = 0, underutilised = 0;
  const sectionLoads = {};
  Object.values(roleMap).forEach(r => {
    const load = (r.totalFTE / r.hc) * 100;
    if (load > 100) overloaded++;
    if (load < 60) underutilised++;
    if (!sectionLoads[r.section]) sectionLoads[r.section] = [];
    sectionLoads[r.section].push(load);
  });

  const totalEmployees = new Set(data.map(r => r.enroll)).size;
  const uniqueRoles = new Set(data.map(r => r.role)).size;
  const requiredFTE = Object.values(roleMap).reduce((a, b) => a + b.totalFTE, 0);
  const avgLoad = Object.values(roleMap).reduce((a, b) => a + (b.totalFTE / b.hc) * 100, 0) / (Object.values(roleMap).length || 1);

  const kpis = [
    { k: "Total Employees", v: totalEmployees, sub: "Unique Employee Enroll", badge: null },
    { k: "Unique Roles", v: uniqueRoles, sub: "Distinct role names", badge: { t: "All shifts", c: "optimal" } },
    { k: "Required FTE", v: requiredFTE.toFixed(1), sub: "Sum of all FTE", badge: { t: avgLoad.toFixed(1) + "% avg load", c: "optimal" } },
    { k: "Overloaded Roles", v: overloaded, cls: "red", sub: "Workload > 100%", badge: { t: "Action needed", c: "over" } },
    { k: "Underutilised Roles", v: underutilised, cls: "blue", sub: "Workload < 60%", badge: { t: "Review capacity", c: "under" } },
  ];

  Object.keys(sectionLoads).sort().forEach(sec => {
    const avg = sectionLoads[sec].reduce((a, b) => a + b, 0) / sectionLoads[sec].length;
    let badge = avg > 110 ? { t: "Overloaded", c: "over" } : avg < 70 ? { t: "Underutilised", c: "under" } : { t: "Optimal", c: "optimal" };
    kpis.push({ k: `${sec} avg load`, v: avg.toFixed(1) + "%", sub: `${sec} section`, badge });
  });

  document.getElementById("kpiGrid").innerHTML = kpis.map(k => `
    <div class="kpi">
      <h4>${k.k}</h4>
      <div class="v ${k.cls || ''}">${k.v}</div>
      <p>${k.sub}</p>
      ${k.badge ? `<span class="badge ${k.badge.c}">${k.badge.t}</span>` : ""}
    </div>
  `).join("");
}

// ===== CHARTS =====
function renderCharts(data) {
  const empMap = {};
  data.forEach(r => {
    const k = r.enroll + "|" + r.shift;
    if (!empMap[k]) empMap[k] = { mins: 0, shift: r.shift, section: r.section };
    empMap[k].mins += r.actualTime || (r.timePerTask * r.frequency);
  });

  const sec = {};
  Object.values(empMap).forEach(e => {
    if (!sec[e.section]) sec[e.section] = { fte: 0, hc: 0, loads: [] };
    const fte = e.mins / getShiftMinutes(e.shift);
    sec[e.section].fte += fte;
    sec[e.section].hc++;
    sec[e.section].loads.push(fte * 100);
  });

  const labels = Object.keys(sec);
  const fteArr = labels.map(l => +sec[l].fte.toFixed(1));
  const hcArr = labels.map(l => sec[l].hc);
  const loadArr = labels.map(l => +(sec[l].loads.reduce((a, b) => a + b, 0) / sec[l].loads.length).toFixed(1));

  if (chart1) chart1.destroy();
  if (chart2) chart2.destroy();

  chart1 = new Chart(document.getElementById("chart1"), {
    type: "bar",
    data: { labels, datasets: [
      { label: "Required FTE", data: fteArr, backgroundColor: "#1e3a8a" },
      { label: "Headcount", data: hcArr, backgroundColor: "#bfdbfe" }
    ]},
    options: { responsive: true, plugins: { legend: { position: "top" } } }
  });

  chart2 = new Chart(document.getElementById("chart2"), {
    type: "bar",
    data: { labels, datasets: [{ label: "Avg Load %", data: loadArr, backgroundColor: "#f59e0b" }] },
    options: { indexAxis: "y", responsive: true, plugins: { legend: { display: false } } }
  });
}

// ===== ROLE TABLE =====
function renderRoleTable(data) {
  const empMap = {};
  data.forEach(r => {
    const k = r.enroll + "|" + r.shift;
    if (!empMap[k]) empMap[k] = { mins: 0, shift: r.shift, section: r.section, role: r.role, phase: r.phase };
    empMap[k].mins += r.actualTime || (r.timePerTask * r.frequency);
  });

  const roleMap = {};
  Object.values(empMap).forEach(e => {
    const k = e.role + "|" + e.section + "|" + e.phase;
    if (!roleMap[k]) roleMap[k] = { role: e.role, section: e.section, phase: e.phase, fte: 0, hc: 0 };
    roleMap[k].fte += e.mins / getShiftMinutes(e.shift);
    roleMap[k].hc++;
  });

  const rows = Object.values(roleMap).map(r => ({ ...r, load: (r.fte / r.hc) * 100 }))
    .sort((a, b) => b.fte - a.fte);

  const q = document.getElementById("roleSearch").value.toLowerCase();
  const filtered = rows.filter(r => !q || (r.role + r.section + r.phase).toLowerCase().includes(q));

  document.getElementById("roleTable").innerHTML = `
    <table>
      <thead><tr><th>Section</th><th>Role</th><th>HC</th><th>FTE</th><th>Workload</th><th>Phase</th></tr></thead>
      <tbody>${filtered.map(r => `
        <tr>
          <td><span class="tag section">${r.section || ''}</span></td>
          <td>${r.role}</td>
          <td>${r.hc}</td>
          <td>${r.fte.toFixed(2)}</td>
          <td><span class="bar ${r.load > 100 ? 'over' : ''}"><span style="width:${Math.min(r.load, 100)}%"></span></span> ${r.load.toFixed(0)}%</td>
          <td><span class="tag phase">${r.phase || ''}</span></td>
        </tr>`).join("")}
      </tbody>
    </table>`;
}
document.addEventListener("input", e => { if (e.target.id === "roleSearch") renderRoleTable(applyFilters()); });

// ===== ALERTS =====
function renderAlerts(data) {
  const empMap = {};
  data.forEach(r => {
    const k = r.enroll + "|" + r.shift;
    if (!empMap[k]) empMap[k] = { mins: 0, shift: r.shift, section: r.section, role: r.role, phase: r.phase };
    empMap[k].mins += r.actualTime || (r.timePerTask * r.frequency);
  });
  const roleMap = {};
  Object.values(empMap).forEach(e => {
    const k = e.role + "|" + e.section;
    if (!roleMap[k]) roleMap[k] = { role: e.role, section: e.section, phase: e.phase, fte: 0, hc: 0 };
    roleMap[k].fte += e.mins / getShiftMinutes(e.shift);
    roleMap[k].hc++;
  });
  const alerts = Object.values(roleMap).map(r => ({ ...r, load: (r.fte / r.hc) * 100 }))
    .filter(r => r.load > 110).sort((a, b) => b.load - a.load).slice(0, 30);

  document.getElementById("alertsList").innerHTML = alerts.map(r => `
    <div class="alert-item">
      <div>
        <strong>↑ ${r.role}</strong><br>
        <span class="tag section">${r.section}</span>
        <span class="tag" style="background:#fee2e2;color:#991b1b">Overloaded</span>
        <span class="tag phase">${r.phase || ''}</span>
      </div>
      <div class="pct">${r.load.toFixed(0)}%</div>
    </div>`).join("");
}

// ===== EMPLOYEES =====
function renderEmployees(data) {
  const empMap = {};
  data.forEach(r => {
    const k = r.enroll + "|" + r.shift + "|" + r.section + "|" + r.role;
    if (!empMap[k]) empMap[k] = { ...r, mins: 0 };
    empMap[k].mins += r.actualTime || (r.timePerTask * r.frequency);
  });

  const rows = Object.values(empMap).map(e => ({
    ...e,
    fte: e.mins / getShiftMinutes(e.shift),
    load: (e.mins / getShiftMinutes(e.shift)) * 100
  })).sort((a, b) => b.load - a.load);

  const q = document.getElementById("empSearch").value.toLowerCase();
  const filtered = rows.filter(r => !q || (r.employee + r.role + r.section + r.phase).toLowerCase().includes(q));

  document.getElementById("empMeta").textContent =
    `${new Set(filtered.map(r => r.enroll)).size} unique employees · ${filtered.length} task rows`;

  document.getElementById("empTable").innerHTML = `
    <table>
      <thead><tr><th>Section</th><th>Shift</th><th>Employee</th><th>Enroll</th><th>Role</th><th>Task Min</th><th>FTE</th><th>Workload</th><th>Phase</th></tr></thead>
      <tbody>${filtered.slice(0, 500).map(r => `
        <tr>
          <td><span class="tag section">${r.section}</span></td>
          <td>${r.shift}</td>
          <td>${r.employee}</td>
          <td>${r.enroll}</td>
          <td>${r.role}</td>
          <td>${Math.round(r.mins)}</td>
          <td>${r.fte.toFixed(2)}</td>
          <td><span class="bar ${r.load > 100 ? 'over' : ''}"><span style="width:${Math.min(r.load, 100)}%"></span></span> ${r.load.toFixed(0)}%</td>
          <td><span class="tag phase">${r.phase || ''}</span></td>
        </tr>`).join("")}
      </tbody>
    </table>`;
}
document.addEventListener("input", e => { if (e.target.id === "empSearch") renderEmployees(applyFilters()); });

// ===== EVENTS =====
document.getElementById("refreshBtn").onclick = loadData;
loadData();
setInterval(loadData, 5 * 60 * 1000); // auto-refresh every 5 min
