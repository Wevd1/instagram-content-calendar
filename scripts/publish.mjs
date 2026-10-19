import fs from "node:fs";

const CAL = new URL("../calendar.json", import.meta.url);
const RAW = "https://raw.githubusercontent.com/Wevd1/instagram-content-calendar/main/";
const V = process.env.IG_GRAPH_VERSION || "v21.0";
const TOKEN = process.env.IG_ACCESS_TOKEN;
const IG_ID = process.env.IG_BUSINESS_ACCOUNT_ID;
const LIVE = process.argv.includes("--publish");

const cal = JSON.parse(fs.readFileSync(CAL, "utf8"));
const now = new Date();
const urlOf = (m) => RAW + m.split("/").map(encodeURIComponent).join("/");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function g(path, params = {}, method = "POST") {
  const body = new URLSearchParams({ ...params, access_token: TOKEN });
  const url = `https://graph.facebook.com/${V}/${path}`;
  const res = method === "GET" ? await fetch(`${url}?${body}`) : await fetch(url, { method, body });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data?.error?.message || res.statusText);
  return data;
}

async function waitReady(id) {
  for (let i = 0; i < 60; i++) {
    const { status_code } = await g(id, { fields: "status_code" }, "GET");
    if (status_code === "FINISHED") return;
    if (status_code === "ERROR" || status_code === "EXPIRED") throw new Error(`container ${status_code}`);
    await sleep(5000);
  }
  throw new Error("timeout aguardando o processamento do vídeo");
}

async function publishPost(p) {
  const urls = p.media.map(urlOf);
  let creation;
  if (p.type === "reel") {
    creation = (await g(`${IG_ID}/media`, { media_type: "REELS", video_url: urls[0], caption: p.caption, share_to_feed: "true" })).id;
  } else if (p.type === "image") {
    creation = (await g(`${IG_ID}/media`, { image_url: urls[0], caption: p.caption })).id;
  } else if (p.type === "carousel") {
    const kids = [];
    for (const u of urls) kids.push((await g(`${IG_ID}/media`, { image_url: u, is_carousel_item: "true" })).id);
    creation = (await g(`${IG_ID}/media`, { media_type: "CAROUSEL", children: kids.join(","), caption: p.caption })).id;
  } else {
    throw new Error(`tipo desconhecido: ${p.type}`);
  }
  await waitReady(creation);
  return (await g(`${IG_ID}/media_publish`, { creation_id: creation })).id;
}

console.log(LIVE ? "MODO PUBLICAR" : "SIMULAÇÃO (nada será publicado; use --publish para publicar)");
for (const p of cal.posts) {
  const due = new Date(p.scheduled_at) <= now;
  const ready = p.status === "aprovado" && due;
  console.log(`\n[${p.id}] tipo=${p.type} status=${p.status} agendado=${p.scheduled_at} ${ready ? "-> PUBLICAR" : "-> ignorado"}`);
  console.log("  mídia:", p.media.map(urlOf).join(" , "));
  if (!ready) continue;
  if (!LIVE) { console.log("  (simulação) publicaria agora"); continue; }
  if (!TOKEN || !IG_ID) throw new Error("Defina IG_ACCESS_TOKEN e IG_BUSINESS_ACCOUNT_ID no ambiente.");
  try {
    p.ig_media_id = await publishPost(p);
    p.status = "publicado";
    p.published_at = new Date().toISOString();
    p.error = null;
    console.log("  publicado:", p.ig_media_id);
  } catch (e) {
    p.status = "erro";
    p.error = String(e.message || e);
    console.log("  ERRO:", p.error);
  }
  fs.writeFileSync(CAL, JSON.stringify(cal, null, 2) + "\n");
}
