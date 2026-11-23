// خدمة جنى لتقييم البحث: قابلية التطبيق + الأثر المتوقع + المطابقة مع احتياجات الجهات
// تعتمد على نص المخرجات المحفوظة (ملف البحث نفسه يُحذف بعد التحويل حفاظاً على الخصوصية).
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const S = (description: string) => ({ type: "STRING", description });
const A = (description: string) => ({ type: "ARRAY", description, items: { type: "STRING" } });
const I = (description: string) => ({ type: "INTEGER", description });

const SCHEMA = {
  type: "OBJECT",
  properties: {
    applicability_score: I("درجة قابلية البحث للتطبيق من 1 (ضعيفة) إلى 5 (عالية جداً)"),
    applicability_summary: S("خلاصة التقييم في جملتين: لماذا هذه الدرجة"),
    criteria: {
      type: "ARRAY",
      description: "المعايير الخمسة بالترتيب: clarity, feasibility, need, resources, readiness",
      items: {
        type: "OBJECT",
        properties: {
          key: { type: "STRING", enum: ["clarity", "feasibility", "need", "resources", "readiness"] },
          score: I("من 1 إلى 5"),
          note: S("تبرير مختصر مستند إلى البحث"),
        },
        required: ["key", "score", "note"],
      },
    },
    expected_impact: {
      type: "OBJECT",
      properties: {
        level: { type: "STRING", enum: ["high", "medium", "low"], description: "مستوى الأثر المتوقع إذا طُبّق البحث" },
        description: S("وصف الأثر المتوقع على المجتمع أو الجهة المستفيدة (2-3 جمل)"),
        beneficiaries: A("الفئات المستفيدة مباشرة (2-5)"),
        time_horizon: { type: "STRING", enum: ["short", "medium", "long"], description: "متى يظهر الأثر: قصير (أقل من سنة)، متوسط (1-3 سنوات)، طويل (أكثر من 3 سنوات)" },
        indicators: A("مؤشرات قابلة للقياس لمتابعة الأثر بعد التطبيق (3-5)"),
      },
      required: ["level", "description", "beneficiaries", "time_horizon", "indicators"],
    },
    conditions: A("متطلبات أو شروط نجاح التطبيق (2-4)"),
    risks: A("مخاطر أو عوائق محتملة أمام التطبيق (2-4)"),
    matches: {
      type: "ARRAY",
      description: "الاحتياجات المسجلة التي يخدمها البحث فعلاً فقط (اتركها فارغة إن لم يوجد تطابق حقيقي)",
      items: {
        type: "OBJECT",
        properties: {
          ref: S("رمز الاحتياج كما ورد في القائمة، مثل N3"),
          score: I("درجة التطابق من 0 إلى 100"),
          reason: S("لماذا يخدم البحث هذا الاحتياج (جملة أو جملتان)"),
        },
        required: ["ref", "score", "reason"],
      },
    },
  },
  required: ["applicability_score", "applicability_summary", "criteria", "expected_impact", "conditions", "risks", "matches"],
};

const MODELS = [Deno.env.get("GEMINI_MODEL"), "gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-flash-latest"].filter(Boolean) as string[];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function callModel(prompt: string, deadline: number) {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new Error("مفتاح Gemini غير مضاف");
  const payload = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, responseMimeType: "application/json", responseSchema: SCHEMA },
  });
  let lastErr = "";
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const left = deadline - Date.now();
      if (left < 12000) throw new Error("BUSY:" + lastErr);
      let res: Response;
      try {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: payload,
          signal: AbortSignal.timeout(Math.min(left - 6000, 60000)),
        });
      } catch (_e) { lastErr = `${model} timeout`; break; }
      const data = await res.json().catch(() => ({}));
      if ([429, 500, 503, 504].includes(res.status)) {
        lastErr = `${model} ${res.status}`;
        if (attempt === 0 && deadline - Date.now() > 30000) { await sleep(2000); continue; }
        break;
      }
      if (!res.ok) { lastErr = `${model} ${res.status}: ${data?.error?.message ?? ""}`.slice(0, 200); break; }
      const text = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("");
      if (!text) { lastErr = `${model} empty`; break; }
      try { return { value: JSON.parse(text), model: (data?.modelVersion as string) || model }; } catch { lastErr = `${model} bad json`; break; }
    }
  }
  throw new Error("BUSY:" + lastErr);
}

const clamp = (n: unknown, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number(n) || lo)));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "غير مسجل الدخول" }, 401);

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const started = Date.now();
  const { research_id } = await req.json().catch(() => ({}));
  if (!research_id) return json({ error: "رقم البحث مفقود" }, 400);

  const { data: r } = await admin.from("research").select("id,title,status,assessment,outputs(type,content)")
    .eq("id", research_id).eq("user_id", user.id).maybeSingle();
  if (!r) return json({ error: "البحث غير موجود" }, 404);
  if (r.status !== "done" || !r.outputs?.length) return json({ error: "البحث لم يُحوَّل بعد" }, 409);
  // حماية من التكرار السريع: تحديث واحد كل دقيقتين
  const last = r.assessment?.assessed_at ? new Date(r.assessment.assessed_at).getTime() : 0;
  if (Date.now() - last < 120000) return json({ ok: true, cached: true });

  // ملخص البحث من مخرجاته (بدون اسم الباحث)
  const outs = r.outputs as { type: string; content: Record<string, unknown> }[];
  const sectors = [...new Set(outs.flatMap((o) => (o.content.suggested_sectors as string[]) || []))];
  const digest = outs.map((o) => {
    const c = { ...o.content }; delete c.suggested_sectors;
    return `### ${o.type}\n${JSON.stringify(c)}`;
  }).join("\n\n").slice(0, 30000);

  // الاحتياجات المعتمدة: الأقرب قطاعاً أولاً، بحد أقصى 40
  const { data: allNeeds } = await admin.from("needs").select("id,org_name,sectors,title,description,beneficiaries,city")
    .eq("status", "approved").order("created_at", { ascending: false }).limit(200);
  const needs = (allNeeds || [])
    .map((n) => ({ n, s: (n.sectors || []).filter((x: string) => sectors.includes(x)).length }))
    .sort((a, b) => b.s - a.s).slice(0, 40).map((x) => x.n);
  const needsText = needs.length
    ? needs.map((n, i) => `N${i + 1} | ${n.org_name} | ${n.title} | ${String(n.description).slice(0, 500)}${n.beneficiaries ? ` | المستفيدون: ${n.beneficiaries}` : ""}`).join("\n")
    : "(لا توجد احتياجات مسجلة حالياً)";

  const prompt = `أنت مقيّم خبير في نقل المعرفة وتثمير البحث العلمي.
أمامك ملخص بحث (مستخرج من مخرجاته التطبيقية) وقائمة احتياجات سجّلتها جهات مجتمعية.
المطلوب:
1) قدّر قابلية البحث للتطبيق (1-5) وفق خمسة معايير:
   clarity: وضوح النتائج والتوصيات وقابليتها للتحويل لإجراءات،
   feasibility: إمكانية التنفيذ عملياً في البيئة المحلية،
   need: حاجة المجتمع أو الجهات لما يقدمه البحث،
   resources: تكلفة وموارد التطبيق (5 = موارد قليلة ومتاحة)،
   readiness: جاهزية الجهات أو الفئات المستفيدة لتبنّيه.
2) قدّر الأثر المتوقع إذا طُبّق: مستواه، وصفه، المستفيدون، مداه الزمني، ومؤشرات لقياسه.
3) اذكر شروط نجاح التطبيق والمخاطر المحتملة.
4) طابِق البحث مع الاحتياجات: اختر فقط الاحتياجات التي يخدمها البحث فعلاً، وأعطِ كل واحد درجة تطابق (0-100) وسبباً مختصراً. لا تجامل؛ التطابق الضعيف لا يُذكر.
القواعد: اكتب بالعربية الفصحى، كن موضوعياً ومتحفظاً، واستند إلى ما ورد في البحث فقط.

## ملخص البحث: ${r.title}
${digest}

## احتياجات الجهات
${needsText}`;

  try {
    const { value: v, model } = await callModel(prompt, started + 110000);
    const assessment = {
      applicability_score: clamp(v.applicability_score, 1, 5),
      applicability_summary: String(v.applicability_summary || ""),
      criteria: (v.criteria || []).slice(0, 5).map((c: { key: string; score: number; note: string }) => ({ key: c.key, score: clamp(c.score, 1, 5), note: c.note })),
      expected_impact: v.expected_impact || {},
      conditions: v.conditions || [],
      risks: v.risks || [],
      needs_considered: needs.length,
      model,
      assessed_at: new Date().toISOString(),
    };
    const matches = (v.matches || [])
      .map((m: { ref: string; score: number; reason: string }) => {
        const idx = parseInt(String(m.ref).replace(/\D/g, ""), 10) - 1;
        return needs[idx] ? { research_id: r.id, need_id: needs[idx].id, score: clamp(m.score, 0, 100), reason: String(m.reason || "").slice(0, 600) } : null;
      })
      .filter((m: unknown) => m && (m as { score: number }).score >= 50);
    const uniq = [...new Map(matches.map((m: { need_id: string }) => [m.need_id, m])).values()];

    const { error: upErr } = await admin.from("research").update({ assessment }).eq("id", r.id);
    if (upErr) throw new Error(upErr.message);
    await admin.from("need_matches").delete().eq("research_id", r.id);
    if (uniq.length) await admin.from("need_matches").insert(uniq);
    return json({ ok: true, matches: uniq.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("assess failed", msg);
    return json({ error: msg.startsWith("BUSY") ? "خدمة Google مزدحمة حالياً، جرّب التحديث بعد دقائق." : msg }, 503);
  }
});
