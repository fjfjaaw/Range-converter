import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";
import { createHash, timingSafeEqual } from "node:crypto";

type DevSession = { dev?: boolean; unlocked?: string[] };

function sessionConfig() {
  return {
    password: process.env["SESSION_SECRET"]!,
    name: "bridge-session",
    maxAge: 60 * 60 * 24 * 30,
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: "lax" as const,
      path: "/",
    },
  };
}

function safeEqual(a: string, b: string) {
  const x = createHash("sha256").update(a, "utf8").digest();
  const y = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(x, y);
}

async function getSession() {
  return useSession<DevSession>(sessionConfig());
}

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // types for this table are generated asynchronously; keep the call untyped
  return supabaseAdmin as unknown as {
    from: (t: string) => any;
  };
}

export type PublicLink = {
  id: string;
  title: string;
  icon_url: string | null;
  public_description: string | null;
  category: string | null;
  position: number;
  visits: number;
  locked: boolean;
  unlocked: boolean;
  url: string | null;
  private_note?: string | null;
  lock_password?: string | null;
};

type Row = {
  id: string;
  title: string;
  url: string;
  icon_url: string | null;
  public_description: string | null;
  private_note: string | null;
  lock_password: string | null;
  category: string | null;
  position: number;
  visits: number;
};

function shape(row: Row, isDev: boolean, unlocked: string[]): PublicLink {
  const locked = !!row.lock_password;
  const isOpen = !locked || isDev || unlocked.includes(row.id);
  return {
    id: row.id,
    title: row.title,
    icon_url: row.icon_url,
    public_description: row.public_description,
    category: row.category,
    position: row.position,
    visits: row.visits,
    locked,
    unlocked: isOpen,
    url: isOpen ? row.url : null,
    ...(isDev
      ? { private_note: row.private_note, lock_password: row.lock_password }
      : {}),
  };
}

export const getState = createServerFn({ method: "GET" }).handler(async () => {
  const session = await getSession();
  const isDev = !!session.data.dev;
  const unlocked = session.data.unlocked ?? [];
  const client = await db();
  const { data, error } = await client
    .from("bridge_links")
    .select("*")
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return {
    isDev,
    links: ((data ?? []) as Row[]).map((r) => shape(r, isDev, unlocked)),
  };
});

export const enterDevMode = createServerFn({ method: "POST" })
  .inputValidator((data: { password: string }) => data)
  .handler(async ({ data }) => {
    const expected = process.env["DEV_PASSWORD"];
    if (!expected) throw new Error("DEV_PASSWORD is not set");
    if (!data.password || !safeEqual(data.password, expected)) {
      return { ok: false as const };
    }
    const session = await getSession();
    await session.update({ dev: true });
    return { ok: true as const };
  });

export const exitDevMode = createServerFn({ method: "POST" }).handler(async () => {
  const session = await getSession();
  await session.update({ dev: false });
  return { ok: true as const };
});

export const unlockLink = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; password: string }) => data)
  .handler(async ({ data }) => {
    const client = await db();
    const { data: row, error } = await client
      .from("bridge_links")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return { ok: false as const };
    const expected = (row as Row).lock_password;
    if (!expected || !safeEqual(data.password, expected)) {
      return { ok: false as const };
    }
    const session = await getSession();
    const unlocked = session.data.unlocked ?? [];
    if (!unlocked.includes(data.id)) {
      await session.update({ unlocked: [...unlocked, data.id] });
    }
    return { ok: true as const, url: (row as Row).url };
  });

export const countVisit = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const client = await db();
    const { data: row } = await client
      .from("bridge_links")
      .select("visits")
      .eq("id", data.id)
      .maybeSingle();
    const current = (row?.visits as number | undefined) ?? 0;
    await client
      .from("bridge_links")
      .update({ visits: current + 1 })
      .eq("id", data.id);
    return { ok: true as const };
  });

async function requireDev() {
  const session = await getSession();
  if (!session.data.dev) throw new Error("FORBIDDEN");
}

export type LinkInput = {
  id?: string;
  title: string;
  url: string;
  icon_url?: string | null;
  public_description?: string | null;
  private_note?: string | null;
  lock_password?: string | null;
  category?: string | null;
};

export const saveLink = createServerFn({ method: "POST" })
  .inputValidator((data: LinkInput) => {
    const title = (data.title ?? "").trim();
    const url = (data.url ?? "").trim();
    if (!title || title.length > 120) throw new Error("اسم غير صالح");
    if (!/^https?:\/\/.+/i.test(url) || url.length > 2000)
      throw new Error("الرابط يجب أن يبدأ بـ http:// أو https://");
    const clip = (v: string | null | undefined, max: number) => {
      const s = (v ?? "").trim();
      return s ? s.slice(0, max) : null;
    };
    return {
      id: data.id,
      title,
      url,
      icon_url: clip(data.icon_url, 2000),
      public_description: clip(data.public_description, 1000),
      private_note: clip(data.private_note, 2000),
      lock_password: clip(data.lock_password, 200),
      category: clip(data.category, 80),
    };
  })
  .handler(async ({ data }) => {
    await requireDev();
    const client = await db();
    const { id, ...fields } = data;
    if (id) {
      const { error } = await client.from("bridge_links").update(fields).eq("id", id);
      if (error) throw new Error(error.message);
      return { ok: true as const, id };
    }
    const { data: maxRow } = await client
      .from("bridge_links")
      .select("position")
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    const position = ((maxRow?.position as number | undefined) ?? 0) + 1;
    const { data: inserted, error } = await client
      .from("bridge_links")
      .insert({ ...fields, position })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true as const, id: inserted.id as string };
  });

export const deleteLink = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    await requireDev();
    const client = await db();
    const { error } = await client.from("bridge_links").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const reorderLinks = createServerFn({ method: "POST" })
  .inputValidator((data: { ids: string[] }) => data)
  .handler(async ({ data }) => {
    await requireDev();
    const client = await db();
    for (let i = 0; i < data.ids.length; i++) {
      await client
        .from("bridge_links")
        .update({ position: i + 1 })
        .eq("id", data.ids[i]);
    }
    return { ok: true as const };
  });

export const importLinks = createServerFn({ method: "POST" })
  .inputValidator((data: { items: LinkInput[] }) => data)
  .handler(async ({ data }) => {
    await requireDev();
    const client = await db();
    const rows = (data.items ?? [])
      .filter((i) => i && i.title && /^https?:\/\/.+/i.test(i.url ?? ""))
      .map((i, index) => ({
        title: String(i.title).slice(0, 120),
        url: String(i.url).slice(0, 2000),
        icon_url: i.icon_url ?? null,
        public_description: i.public_description ?? null,
        private_note: i.private_note ?? null,
        lock_password: i.lock_password ?? null,
        category: i.category ?? null,
        position: 1000 + index,
      }));
    if (!rows.length) return { ok: true as const, count: 0 };
    const { error } = await client.from("bridge_links").insert(rows);
    if (error) throw new Error(error.message);
    return { ok: true as const, count: rows.length };
  });
