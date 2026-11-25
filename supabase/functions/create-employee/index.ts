// Supabase Edge Function: manager-only user administration.
// Actions: create | reset_password | set_active
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Who is calling?
    const authHeader = req.headers.get("Authorization") ?? "";
    const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: u } = await caller.auth.getUser();
    if (!u?.user) return json({ error: "Not signed in" }, 401);

    const admin = createClient(url, service);
    const { data: me } = await admin.from("profiles").select("role,active").eq("id", u.user.id).single();
    if (!me || me.role !== "manager" || !me.active) return json({ error: "Managers only" }, 403);

    const b = await req.json();

    if (b.action === "create") {
      const email = String(b.email ?? "").trim().toLowerCase();
      const password = String(b.password ?? "");
      const full_name = String(b.full_name ?? "").trim();
      if (!email || !full_name) return json({ error: "Name and email are required" }, 400);
      if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);
      const role = b.role === "manager" ? "manager" : "employee";

      const { data, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: {
          full_name,
          department: b.department ?? null,
          employee_code: b.employee_code ?? null,
        },
      });
      if (error) return json({ error: error.message }, 400);
      await admin.from("profiles")
        .update({ role, must_change_password: true })
        .eq("id", data.user!.id);
      return json({ ok: true, id: data.user!.id });
    }

    if (b.action === "reset_password") {
      const password = String(b.password ?? "");
      if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);
      const { error } = await admin.auth.admin.updateUserById(b.user_id, { password });
      if (error) return json({ error: error.message }, 400);
      await admin.from("profiles").update({ must_change_password: true }).eq("id", b.user_id);
      return json({ ok: true });
    }

    if (b.action === "set_active") {
      if (b.user_id === u.user.id) return json({ error: "You cannot deactivate yourself" }, 400);
      const active = !!b.active;
      const { error } = await admin.auth.admin.updateUserById(b.user_id, {
        ban_duration: active ? "none" : "876000h",
      });
      if (error) return json({ error: error.message }, 400);
      await admin.from("profiles").update({ active }).eq("id", b.user_id);
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
