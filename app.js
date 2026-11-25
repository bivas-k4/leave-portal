import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY, LEAVE_TYPES, COMPANY_NAME } from "./config.js";

const app = document.getElementById("app");
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => ymd(new Date());
const addDays = (s, n) => { const d = new Date(s + "T00:00:00"); d.setDate(d.getDate() + n); return ymd(d); };
const fmt = (s) => new Date(s + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const range = (r) => (r.start_date === r.end_date ? fmt(r.start_date) : `${fmt(r.start_date)} – ${fmt(r.end_date)}`);
const badge = (s) => `<span class="badge ${esc(s)}">${esc(s)}</span>`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function workdays(a, b) {
  if (!a || !b || b < a) return 0;
  let n = 0;
  const d = new Date(a + "T00:00:00"), e = new Date(b + "T00:00:00");
  for (; d <= e; d.setDate(d.getDate() + 1)) { const g = d.getDay(); if (g !== 0 && g !== 6) n++; }
  return n;
}
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 3500);
}
function genPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const a = new Uint32Array(12); crypto.getRandomValues(a);
  return Array.from(a, (x) => chars[x % chars.length]).join("");
}
function modal(title, bodyHtml, okText = "OK", cancel = true) {
  return new Promise((res) => {
    const d = $("#dlg");
    d.innerHTML = `<form method="dialog"><h3>${esc(title)}</h3>${bodyHtml}
      <div class="row end rev"><button value="ok" class="btn">${esc(okText)}</button>
      ${cancel ? '<button value="cancel" class="btn ghost" formnovalidate>Cancel</button>' : ""}</div></form>`;
    d.onclose = () => res(d.returnValue === "ok" ? d : null);
    d.returnValue = "";
    d.showModal();
  });
}

if (SUPABASE_URL.includes("YOUR-PROJECT")) {
  app.innerHTML = `<div class="card narrow"><h2>Setup needed</h2><p>Open <code>config.js</code> and add your Supabase URL and anon key. See the README.</p></div>`;
  throw new Error("config.js not filled in");
}
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let me = null, tab = "mine", pendingCount = 0, lastList = [];

sb.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_OUT") { me = null; loginView(); } });

/* ------------------------------------------------------------ auth */
async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return loginView();
  await loadMe(session.user.id);
}
async function loadMe(id) {
  const { data, error } = await sb.from("profiles").select("*").eq("id", id).single();
  if (error || !data || !data.active) {
    await sb.auth.signOut();
    return loginView(error ? "Could not load your profile." : "Your account is inactive. Contact your manager.");
  }
  me = data;
  if (me.must_change_password) return passwordView(true);
  tab = me.role === "manager" ? "dashboard" : "mine";
  shell();
}
function loginView(msg = "") {
  app.innerHTML = `<form class="card narrow" id="loginForm">
    <h1>${esc(COMPANY_NAME)}</h1><p class="muted">Leave portal – sign in</p>
    <div class="field"><label for="em">Email</label><input id="em" type="email" autocomplete="username" required></div>
    <div class="field"><label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password" required></div>
    <div class="error" id="err">${esc(msg)}</div>
    <button class="btn" style="width:100%">Sign in</button>
    <p class="muted small">Forgot your password? Ask your manager to reset it.</p></form>`;
  $("#loginForm").onsubmit = async (e) => {
    e.preventDefault();
    const btn = $("button", e.target); btn.disabled = true;
    const { data, error } = await sb.auth.signInWithPassword({ email: $("#em").value.trim(), password: $("#pw").value });
    if (error) { $("#err").textContent = "Wrong email or password."; btn.disabled = false; return; }
    await loadMe(data.user.id);
  };
}
function passwordView(forced) {
  app.innerHTML = `<form class="card narrow" id="pwForm">
    <h2>${forced ? "Set your own password" : "Change password"}</h2>
    ${forced ? '<p class="muted">Your manager gave you a temporary password. Choose a new one to continue.</p>' : ""}
    <div class="field"><label for="n1">New password (min 8 characters)</label><input id="n1" type="password" minlength="8" autocomplete="new-password" required></div>
    <div class="field"><label for="n2">Confirm new password</label><input id="n2" type="password" minlength="8" autocomplete="new-password" required></div>
    <div class="error" id="err"></div>
    <button class="btn" style="width:100%">Save password</button>
    ${forced ? '<p class="small"><a href="#" id="out">Sign out</a></p>' : ""}</form>`;
  const out = $("#out"); if (out) out.onclick = (e) => { e.preventDefault(); sb.auth.signOut(); };
  $("#pwForm").onsubmit = async (e) => {
    e.preventDefault();
    const a = $("#n1").value, b = $("#n2").value;
    if (a !== b) return ($("#err").textContent = "Passwords do not match.");
    const { error } = await sb.auth.updateUser({ password: a });
    if (error) return ($("#err").textContent = error.message);
    await sb.from("profiles").update({ must_change_password: false }).eq("id", me.id);
    me.must_change_password = false;
    toast("Password updated");
    forced ? shell() : renderTab();
  };
}

/* ------------------------------------------------------------ shell */
async function shell() {
  const mgr = me.role === "manager";
  const tabs = mgr
    ? [["dashboard", "Dashboard"], ["approvals", "Approvals"], ["all", "All requests"], ["employees", "Employees"], ["mine", "My leave"], ["account", "Account"]]
    : [["mine", "My leave"], ["account", "Account"]];
  if (mgr) {
    const { count } = await sb.from("leave_requests").select("id", { count: "exact", head: true }).eq("status", "pending");
    pendingCount = count || 0;
  }
  app.innerHTML = `<header class="top"><span class="brand">${esc(COMPANY_NAME)} · Leave</span>
    <span class="who"><span>${esc(me.full_name)} <span class="badge neutral">${esc(me.role)}</span></span>
    <button class="btn ghost sm" id="logout">Sign out</button></span></header>
    <nav class="tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? "on" : ""}">${l}${k === "approvals" && pendingCount ? `<span class="count">${pendingCount}</span>` : ""}</button>`).join("")}</nav>
    <main id="content"></main>`;
  $("#logout").onclick = () => sb.auth.signOut();
  document.querySelectorAll("nav.tabs button").forEach((b) => (b.onclick = () => { tab = b.dataset.tab; shell(); }));
  renderTab();
}
async function renderTab() {
  const c = $("#content");
  if (!c) return;
  c.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const views = { mine: viewMine, dashboard: viewDashboard, approvals: viewApprovals, all: viewAll, employees: viewEmployees, account: viewAccount };
    await views[tab](c);
  } catch (e) { c.innerHTML = `<div class="card error">${esc(e.message || e)}</div>`; }
}

/* ------------------------------------------------------------ data */
async function getRequests(f = {}) {
  let q = sb.from("leave_requests").select("*, profile:profiles!user_id(full_name,department,employee_code)").order("created_at", { ascending: false });
  if (f.status) q = q.eq("status", f.status);
  if (f.user_id) q = q.eq("user_id", f.user_id);
  if (f.type) q = q.eq("leave_type", f.type);
  if (f.from) q = q.gte("end_date", f.from);
  if (f.to) q = q.lte("start_date", f.to);
  const { data, error } = await q.limit(2000);
  if (error) throw error;
  return data;
}
async function admin(body) {
  const { data, error } = await sb.functions.invoke("create-employee", { body });
  if (error) {
    let m = error.message;
    try { m = (await error.context.json()).error || m; } catch { /* keep default */ }
    throw new Error(m);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
function usage(reqs, year) {
  const u = {};
  for (const r of reqs) {
    if (!r.start_date.startsWith(String(year))) continue;
    if (r.status !== "approved" && r.status !== "pending") continue;
    const o = (u[r.leave_type] ??= { approved: 0, pending: 0 });
    o[r.status] += r.days;
  }
  return u;
}
function requestsTable(rows, { showWho = false, actions = null } = {}) {
  if (!rows.length) return '<p class="empty">Nothing here yet.</p>';
  return `<div class="tablewrap"><table><thead><tr>${showWho ? "<th>Employee</th>" : ""}<th>Type</th><th>Dates</th><th>Days</th><th>Reason</th><th>Status</th><th>Manager note</th>${actions ? "<th></th>" : ""}</tr></thead><tbody>
  ${rows.map((r) => `<tr>${showWho ? `<td>${esc(r.profile?.full_name)}<div class="muted small">${esc(r.profile?.department)}</div></td>` : ""}
  <td>${esc(r.leave_type)}</td><td>${range(r)}</td><td>${r.days}</td><td>${esc(r.reason)}</td><td>${badge(r.status)}</td><td>${esc(r.manager_comment)}</td>
  ${actions ? `<td class="act">${actions(r)}</td>` : ""}</tr>`).join("")}</tbody></table></div>`;
}

/* ------------------------------------------------------------ employee view */
async function viewMine(c) {
  const year = new Date().getFullYear();
  const reqs = await getRequests({ user_id: me.id });
  const u = usage(reqs, year);
  c.innerHTML = `<h2>My leave balance · ${year}</h2><div class="grid">
    ${LEAVE_TYPES.map((t) => {
      const a = u[t.name]?.approved || 0, p = u[t.name]?.pending || 0;
      const pct = (x) => (t.allowance ? Math.min(100, (x / t.allowance) * 100) : 0);
      return `<div class="stat"><div class="l">${esc(t.name)}</div>
        <div class="n">${t.allowance === null ? a : Math.max(0, t.allowance - a - p)}<span class="small muted"> ${t.allowance === null ? "days taken" : "left"}</span></div>
        ${t.allowance ? `<div class="bar" title="approved / pending"><i style="width:${pct(a)}%"></i><i class="p" style="width:${pct(p)}%"></i></div>` : ""}
        <div class="sub">${a} approved${p ? ` · ${p} pending` : ""}${t.allowance ? ` of ${t.allowance}` : ""}</div></div>`;
    }).join("")}</div>
  <form class="card" id="applyForm"><h2>Apply for leave</h2>
    <div class="row">
      <div class="field"><label for="lt">Type</label><select id="lt">${LEAVE_TYPES.map((t) => `<option>${esc(t.name)}</option>`).join("")}</select></div>
      <div class="field"><label for="sd">From</label><input id="sd" type="date" min="${todayStr()}" required></div>
      <div class="field"><label for="ed">To</label><input id="ed" type="date" min="${todayStr()}" required></div>
      <div class="field"><label>Working days</label><input id="dd" value="0" disabled></div>
    </div>
    <div class="field"><label for="rs">Reason</label><textarea id="rs" rows="2" maxlength="500" required></textarea></div>
    <div class="error" id="err"></div><button class="btn">Submit request</button></form>
  <div class="card"><h2>My requests</h2>${requestsTable(reqs, { actions: (r) => (r.status === "pending" ? `<button class="btn ghost sm" data-act="cancel" data-id="${r.id}">Cancel</button>` : "") })}</div>`;

  const upd = () => ($("#dd").value = workdays($("#sd").value, $("#ed").value));
  $("#sd").onchange = () => { if (!$("#ed").value || $("#ed").value < $("#sd").value) $("#ed").value = $("#sd").value; $("#ed").min = $("#sd").value; upd(); };
  $("#ed").onchange = upd;
  $("#applyForm").onsubmit = async (e) => {
    e.preventDefault();
    const rec = { user_id: me.id, leave_type: $("#lt").value, start_date: $("#sd").value, end_date: $("#ed").value, reason: $("#rs").value.trim() };
    const days = workdays(rec.start_date, rec.end_date);
    if (!days) return ($("#err").textContent = "Those dates fall only on weekends.");
    const t = LEAVE_TYPES.find((x) => x.name === rec.leave_type);
    const used = (u[t.name]?.approved || 0) + (u[t.name]?.pending || 0);
    if (t.allowance && used + days > t.allowance && !confirm(`This exceeds your ${t.name} balance. Submit anyway?`)) return;
    const { error } = await sb.from("leave_requests").insert(rec);
    if (error) return ($("#err").textContent = error.message);
    toast("Request submitted"); renderTab();
  };
  c.onclick = async (e) => {
    const b = e.target.closest("[data-act=cancel]"); if (!b) return;
    if (!confirm("Cancel this request?")) return;
    const { error } = await sb.from("leave_requests").update({ status: "cancelled" }).eq("id", b.dataset.id);
    if (error) return toast(error.message);
    toast("Request cancelled"); renderTab();
  };
}

/* ------------------------------------------------------------ manager: dashboard */
function bars(items) {
  const max = Math.max(1, ...items.map((i) => i[1]));
  if (!items.length) return '<p class="empty">No data yet.</p>';
  return items.map(([l, v]) => `<div class="hbar"><span class="lab" title="${esc(l)}">${esc(l)}</span><span class="track"><span class="fill" style="display:block;width:${(v / max) * 100}%"></span></span><span class="val">${v}</span></div>`).join("");
}
async function viewDashboard(c) {
  const year = new Date().getFullYear(), t = todayStr();
  const [reqs, { data: people }] = await Promise.all([
    getRequests({ from: `${year}-01-01` }),
    sb.from("profiles").select("id,department,active"),
  ]);
  const approved = reqs.filter((r) => r.status === "approved");
  const pending = reqs.filter((r) => r.status === "pending");
  const out = approved.filter((r) => r.start_date <= t && r.end_date >= t);
  const soon = approved.filter((r) => r.start_date > t && r.start_date <= addDays(t, 14)).sort((a, b) => a.start_date.localeCompare(b.start_date));
  const monthStart = `${year}-${pad(new Date().getMonth() + 1)}`;
  const monthDays = approved.filter((r) => r.start_date.startsWith(monthStart)).reduce((s, r) => s + r.days, 0);
  const sum = (key) => { const m = {}; approved.forEach((r) => { const k = key(r) || "—"; m[k] = (m[k] || 0) + r.days; }); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
  const byMonth = MONTHS.map((m, i) => [m, approved.filter((r) => +r.start_date.slice(5, 7) === i + 1).reduce((s, r) => s + r.days, 0)]);
  const active = (people || []).filter((p) => p.active).length;

  c.innerHTML = `<div class="grid">
    <div class="stat"><div class="n">${pending.length}</div><div class="l">Pending approvals</div></div>
    <div class="stat"><div class="n">${out.length}</div><div class="l">Out today</div><div class="sub">of ${active} active staff</div></div>
    <div class="stat"><div class="n">${soon.length}</div><div class="l">Starting in next 14 days</div></div>
    <div class="stat"><div class="n">${monthDays}</div><div class="l">Approved days this month</div></div></div>
  <div class="grid two">
    <div class="card"><h2>Out today</h2>${out.length ? out.map((r) => `<p>${esc(r.profile?.full_name)} <span class="muted small">${esc(r.profile?.department)} · ${esc(r.leave_type)} · until ${fmt(r.end_date)}</span></p>`).join("") : '<p class="empty">Everyone is in.</p>'}</div>
    <div class="card"><h2>Upcoming (14 days)</h2>${soon.length ? soon.map((r) => `<p>${esc(r.profile?.full_name)} <span class="muted small">${range(r)} · ${r.days}d</span></p>`).join("") : '<p class="empty">No upcoming leave.</p>'}</div>
    <div class="card"><h2>Approved days by month · ${year}</h2>${bars(byMonth)}</div>
    <div class="card"><h2>By leave type</h2>${bars(sum((r) => r.leave_type))}<h2 style="margin-top:1rem">By department</h2>${bars(sum((r) => r.profile?.department))}</div>
  </div>`;
}

/* ------------------------------------------------------------ manager: approvals */
async function viewApprovals(c) {
  const [pending, approved] = await Promise.all([getRequests({ status: "pending" }), getRequests({ status: "approved", from: todayStr() })]);
  pending.sort((a, b) => a.start_date.localeCompare(b.start_date));
  c.innerHTML = `<div class="card"><h2>Pending requests</h2>${
    pending.length ? `<div class="tablewrap"><table><thead><tr><th>Employee</th><th>Type</th><th>Dates</th><th>Days</th><th>Reason</th><th>Team cover</th><th></th></tr></thead><tbody>
    ${pending.map((r) => {
      const clash = approved.filter((a) => a.user_id !== r.user_id && a.profile?.department === r.profile?.department && a.start_date <= r.end_date && a.end_date >= r.start_date);
      return `<tr><td>${esc(r.profile?.full_name)}<div class="muted small">${esc(r.profile?.department)}</div></td><td>${esc(r.leave_type)}</td><td>${range(r)}</td><td>${r.days}</td><td>${esc(r.reason)}</td>
      <td class="small">${clash.length ? `<span class="badge pending">${clash.length} already off</span><div class="muted">${esc(clash.map((x) => x.profile?.full_name).join(", "))}</div>` : '<span class="muted">No overlap</span>'}</td>
      <td class="act"><button class="btn ok sm" data-act="approved" data-id="${r.id}">Approve</button><button class="btn bad sm" data-act="rejected" data-id="${r.id}">Reject</button></td></tr>`;
    }).join("")}</tbody></table></div>` : '<p class="empty">All caught up – nothing pending.</p>'}</div>`;
  c.onclick = async (e) => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const status = b.dataset.act;
    const d = await modal(status === "approved" ? "Approve request" : "Reject request",
      `<div class="field"><label for="cm">Note to employee ${status === "rejected" ? "(recommended)" : "(optional)"}</label><textarea id="cm" rows="3" maxlength="300"></textarea></div>`, status === "approved" ? "Approve" : "Reject");
    if (!d) return;
    const { error } = await sb.from("leave_requests").update({ status, manager_comment: $("#cm", d).value.trim() || null }).eq("id", b.dataset.id);
    if (error) return toast(error.message);
    toast(`Request ${status}`); shell();
  };
}

/* ------------------------------------------------------------ manager: all requests */
function csvCell(v) { let s = String(v ?? ""); if (/^[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; }
async function viewAll(c) {
  const { data: people } = await sb.from("profiles").select("id,full_name").order("full_name");
  const year = new Date().getFullYear();
  c.innerHTML = `<form class="card" id="flt"><div class="row">
    <div><label>Status</label><select id="fs"><option value="">All</option><option>pending</option><option>approved</option><option>rejected</option><option>cancelled</option></select></div>
    <div><label>Employee</label><select id="fu"><option value="">Everyone</option>${(people || []).map((p) => `<option value="${p.id}">${esc(p.full_name)}</option>`).join("")}</select></div>
    <div><label>Type</label><select id="ft"><option value="">All</option>${LEAVE_TYPES.map((t) => `<option>${esc(t.name)}</option>`).join("")}</select></div>
    <div><label>From</label><input type="date" id="ff" value="${year}-01-01"></div>
    <div><label>To</label><input type="date" id="fe"></div>
    <div><button class="btn">Filter</button></div><div><button type="button" class="btn ghost" id="csv">Export CSV</button></div></div></form>
  <div class="card" id="res"></div>`;
  const run = async () => {
    lastList = await getRequests({ status: $("#fs").value, user_id: $("#fu").value, type: $("#ft").value, from: $("#ff").value, to: $("#fe").value });
    $("#res").innerHTML = `<p class="muted small">${lastList.length} request(s)</p>` + requestsTable(lastList, { showWho: true });
  };
  $("#flt").onsubmit = (e) => { e.preventDefault(); run().catch((x) => toast(x.message)); };
  $("#csv").onclick = () => {
    const head = ["Employee", "Department", "Type", "From", "To", "Days", "Status", "Reason", "Manager note"];
    const rows = lastList.map((r) => [r.profile?.full_name, r.profile?.department, r.leave_type, r.start_date, r.end_date, r.days, r.status, r.reason, r.manager_comment]);
    const blob = new Blob([[head, ...rows].map((r) => r.map(csvCell).join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `leave-${todayStr()}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  await run();
}

/* ------------------------------------------------------------ manager: employees */
async function viewEmployees(c) {
  const year = new Date().getFullYear();
  const [{ data: people, error }, reqs] = await Promise.all([sb.from("profiles").select("*").order("full_name"), getRequests({ from: `${year}-01-01` })]);
  if (error) throw error;
  const taken = {};
  reqs.filter((r) => r.status === "approved" && r.start_date.startsWith(String(year))).forEach((r) => (taken[r.user_id] = (taken[r.user_id] || 0) + r.days));
  c.innerHTML = `<form class="card" id="addForm"><h2>Add employee</h2>
    <div class="row">
      <div class="field"><label>Full name</label><input id="an" required></div>
      <div class="field"><label>Work email</label><input id="ae" type="email" required></div>
      <div class="field"><label>Employee ID</label><input id="ac"></div>
      <div class="field"><label>Department</label><input id="ad"></div>
      <div class="field"><label>Role</label><select id="ar"><option value="employee">Employee</option><option value="manager">Manager</option></select></div>
      <div class="field"><label>Temporary password</label><input id="ap" value="${genPassword()}" minlength="8" required></div>
    </div><div class="error" id="err"></div><button class="btn">Create account</button></form>
  <div class="card"><h2>Team (${people.length})</h2><div class="tablewrap"><table><thead><tr><th>Name</th><th>ID</th><th>Department</th><th>Role</th><th>Days taken ${year}</th><th>Status</th><th></th></tr></thead><tbody>
  ${people.map((p) => `<tr><td>${esc(p.full_name)}<div class="muted small">${esc(p.email)}</div></td><td>${esc(p.employee_code)}</td><td>${esc(p.department)}</td><td>${esc(p.role)}</td><td>${taken[p.id] || 0}</td>
  <td>${badge(p.active ? "approved" : "cancelled").replace(">approved<", ">active<").replace(">cancelled<", ">inactive<")}</td>
  <td class="act">${p.id === me.id ? "" : `<button class="btn ghost sm" data-act="reset" data-id="${p.id}" data-name="${esc(p.full_name)}">Reset password</button><button class="btn ghost sm" data-act="toggle" data-id="${p.id}" data-active="${p.active}">${p.active ? "Deactivate" : "Activate"}</button>`}</td></tr>`).join("")}
  </tbody></table></div></div>`;

  $("#addForm").onsubmit = async (e) => {
    e.preventDefault();
    const btn = $("button", e.target); btn.disabled = true; $("#err").textContent = "";
    const body = { action: "create", full_name: $("#an").value.trim(), email: $("#ae").value.trim(), employee_code: $("#ac").value.trim(), department: $("#ad").value.trim(), role: $("#ar").value, password: $("#ap").value };
    try {
      await admin(body);
      await modal("Account created", `<p>Share these details with ${esc(body.full_name)} privately. They will be asked to set their own password at first sign-in.</p><p><b>Email:</b> ${esc(body.email)}<br><b>Temporary password:</b> <code>${esc(body.password)}</code></p>`, "Done", false);
      renderTab();
    } catch (x) { $("#err").textContent = x.message; btn.disabled = false; }
  };
  c.onclick = async (e) => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    try {
      if (b.dataset.act === "reset") {
        const d = await modal("Reset password", `<p>New temporary password for ${esc(b.dataset.name)}. They must change it at next sign-in.</p><div class="field"><input id="np" value="${genPassword()}" minlength="8" required></div>`, "Reset");
        if (!d) return;
        const pw = $("#np", d).value;
        await admin({ action: "reset_password", user_id: b.dataset.id, password: pw });
        await modal("Password reset", `<p>Temporary password: <code>${esc(pw)}</code></p>`, "Done", false);
      } else if (b.dataset.act === "toggle") {
        const on = b.dataset.active !== "true";
        if (!on && !confirm("Deactivate this employee? They will no longer be able to sign in.")) return;
        await admin({ action: "set_active", user_id: b.dataset.id, active: on });
        toast(on ? "Activated" : "Deactivated"); renderTab();
      }
    } catch (x) { toast(x.message); }
  };
}

/* ------------------------------------------------------------ account */
async function viewAccount(c) {
  c.innerHTML = `<div class="card"><h2>My account</h2><p><b>${esc(me.full_name)}</b><br>${esc(me.email)}<br><span class="muted">${esc(me.department)} ${me.employee_code ? "· ID " + esc(me.employee_code) : ""}</span></p>
  <button class="btn" id="chg">Change password</button></div>`;
  $("#chg").onclick = () => passwordView(false);
}

boot();
