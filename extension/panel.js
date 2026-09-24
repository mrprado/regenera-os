// Side panel. Talks only to Regenera OS, only after a click, and only about the profile in the active tab.
const $ = id => document.getElementById(id);
const show = (id, on) => { $(id).hidden = !on; };
let cfg = { base: "https://regenera.bio/os", token: "" };
let current = null; // { url, tabId }

function status(msg) { $("status").textContent = msg || ""; }
const baseUrl = () => cfg.base.replace(/\/$/, "");

async function api(body) {
  const res = await fetch(`${baseUrl()}/api/webhooks/extension`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.token}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Regenera OS returned ${res.status}`);
  return json;
}

function taskCard(t) {
  const div = document.createElement("div");
  div.className = "task";
  const kind = document.createElement("div");
  kind.className = "kind";
  kind.textContent = `${t.type === "linkedin_connect" ? "Connection note" : "Message"} · due ${t.dueAt.slice(0, 10)}`;
  const pre = document.createElement("pre");
  pre.textContent = t.body;
  const copy = document.createElement("button");
  copy.textContent = "Copy";
  copy.onclick = async () => { await navigator.clipboard.writeText(t.body); status("Copied. Paste it on LinkedIn and send it yourself."); };
  const sent = document.createElement("button");
  sent.className = "primary";
  sent.textContent = "Mark sent";
  sent.onclick = async () => {
    try { render(await api({ action: "mark_sent", taskId: t.id })); status("Marked sent. The sequence moves to the next step."); }
    catch (e) { status(e.message); }
  };
  div.append(kind, pre, copy, document.createTextNode(" "), sent);
  return div;
}

function render(data) {
  show("known", !!data.contact);
  show("unknown", !data.contact);
  if (!data.contact) return;
  $("name").textContent = data.contact.fullName;
  $("sub").textContent = [data.contact.title, data.contact.orgName].filter(Boolean).join(" · ");
  $("open").href = `${baseUrl()}/people/${data.contact.id}`;
  const box = $("tasks");
  box.textContent = "";
  show("noTasks", data.tasks.length === 0);
  for (const t of data.tasks) box.append(taskCard(t));
}

async function refresh() {
  status("");
  if (!cfg.token) { show("setup", true); show("profile", false); show("notProfile", false); return; }
  show("setup", false);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab && tab.url ? tab.url.split("?")[0] : "";
  if (!/^https:\/\/www\.linkedin\.com\/in\/[^/]+/.test(url)) { current = null; show("profile", false); show("notProfile", true); return; }
  current = { url, tabId: tab.id };
  show("notProfile", false);
  show("profile", true);
  try { render(await api({ action: "lookup", url })); } catch (e) { status(e.message); }
}

$("save").onclick = async () => {
  cfg = { base: $("base").value.trim() || "https://regenera.bio/os", token: $("token").value.trim() };
  await chrome.storage.local.set({ cfg });
  refresh();
};
$("settings").onclick = e => { e.preventDefault(); $("base").value = cfg.base; $("token").value = ""; show("setup", true); };

$("read").onclick = async () => {
  if (!current) return;
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId: current.tabId }, files: ["extract.js"] });
    const p = r && r.result ? r.result : {};
    $("f-name").value = p.name || "";
    $("f-title").value = p.title || "";
    $("f-company").value = p.company || "";
    $("f-location").value = p.location || "";
    $("f-headline").value = p.headline || "";
    status("Check the fields, then save.");
  } catch (e) { status(`Could not read the page: ${e.message}`); }
};

$("capture").onclick = async () => {
  if (!current) return;
  const profile = {
    url: current.url, name: $("f-name").value.trim(), title: $("f-title").value.trim(),
    company: $("f-company").value.trim(), location: $("f-location").value.trim(), headline: $("f-headline").value.trim(),
  };
  if (!profile.name) { status("Read the profile or type the name first."); return; }
  try {
    const data = await api({ action: "capture", profile });
    render(data);
    status(data.created ? "Saved as a new person in Regenera OS." : "Updated the existing record.");
  } catch (e) { status(e.message); }
};

chrome.tabs.onActivated.addListener(refresh);
chrome.tabs.onUpdated.addListener((_id, info) => { if (info.url || info.status === "complete") refresh(); });
chrome.storage.local.get("cfg").then(v => { if (v.cfg) cfg = v.cfg; refresh(); });
