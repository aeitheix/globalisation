import { getStore } from "@netlify/blobs";

const MAX_REVS = 100;      // keep this many revisions
const COALESCE_MS = 120000; // saves within 2 min of the last one update it in place

const json = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export default async (req) => {
  const store = getStore("deck");
  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "latest";
  const index = (await store.get("index", { type: "json" })) || [];

  if (req.method === "GET") {
    if (action === "list") return json({ revs: [...index].reverse() });
    if (action === "get") {
      const r = await store.get("r/" + url.searchParams.get("id"), { type: "json" });
      return r ? json(r) : json({ error: "not found" }, 404);
    }
    const last = index[index.length - 1];
    if (!last) return json({ empty: true });
    return json(await store.get("r/" + last.id, { type: "json" }));
  }

  if (req.method === "POST") {
    // Optional protection: set EDIT_KEY in Netlify env vars to require a passcode for saving.
    const need = Netlify.env.get("EDIT_KEY");
    if (need && req.headers.get("x-edit-key") !== need) return json({ error: "unauthorized" }, 401);

    let body;
    try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
    let html = body.html;
    let label = body.label || "";
    if (action === "restore") {
      const r = await store.get("r/" + body.id, { type: "json" });
      if (!r) return json({ error: "not found" }, 404);
      html = r.html;
      label = "Restored from " + new Date(r.ts).toISOString();
    }
    if (typeof html !== "string" || html.length < 50 || html.length > 4_000_000) return json({ error: "bad html" }, 400);

    const now = Date.now();
    const last = index[index.length - 1];
    let id;
    if (action === "save" && last && !last.label && now - last.ts < COALESCE_MS) {
      id = last.id; // update in place
      index[index.length - 1] = { id, ts: now, size: html.length, label: "" };
    } else {
      id = String(now).padStart(14, "0");
      index.push({ id, ts: now, size: html.length, label });
    }
    await store.setJSON("r/" + id, { id, ts: now, html, label });
    while (index.length > MAX_REVS) { const old = index.shift(); await store.delete("r/" + old.id); }
    await store.setJSON("index", index);
    return json({ ok: true, id, ts: now });
  }
  return json({ error: "method" }, 405);
};

export const config = { path: "/api/deck" };
