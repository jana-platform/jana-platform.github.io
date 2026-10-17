// خدمة جنى لتوليد المخرجات
// تستقبل رقم البحث، تقرأ ملف PDF من التخزين المؤقت، ترسله إلى Gemini،
// تحفظ المخرجات، ثم تحذف ملف البحث نهائياً (سواء نجحت العملية أو فشلت).
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const ALLOWED = ["policy_brief", "poster", "social"] as const;
type OutType = typeof ALLOWED[number];

const S = (description: string) => ({ type: "STRING", description });
const A = (description: string) => ({ type: "ARRAY", description, items: { type: "STRING" } });

const SCHEMAS: Record<OutType, unknown> = {
  policy_brief: {
    type: "OBJECT",
    properties: {
      title: S("عنوان جذاب لموجز السياسات"),
      executive_summary: S("ملخص تنفيذي في فقرة واحدة لصانع القرار"),
      problem: S("القضية أو المشكلة التي يعالجها البحث وأهميتها"),
      key_findings: A("أهم النتائج بلغة واضحة (3-6 نقاط)"),
      recommendations: {
        type: "ARRAY",
        description: "توصيات عملية قابلة للتنفيذ (3-6)",
        items: {
          type: "OBJECT",
          properties: { text: S("نص التوصية"), target: S("الجهة المعنية بالتنفيذ") },
          required: ["text", "target"],
        },
      },
      target_audience: S("الجمهور المستهدف من الموجز"),
      conclusion: S("خاتمة قصيرة"),
    },
    required: ["title", "executive_summary", "problem", "key_findings", "recommendations", "target_audience", "conclusion"],
  },
  poster: {
    type: "OBJECT",
    properties: {
      title: S("عنوان الملصق"),
      introduction: S("مقدمة قصيرة (2-3 جمل)"),
      objectives: A("أهداف البحث (2-4)"),
      methodology: S("المنهجية والعينة والأدوات باختصار"),
      results: A("أبرز النتائج (3-5 نقاط قصيرة)"),
      conclusion: S("الخلاصة والتوصية الرئيسية"),
      keywords: A("كلمات مفتاحية (3-6)"),
    },
    required: ["title", "introduction", "objectives", "methodology", "results", "conclusion", "keywords"],
  },
  social: {
    type: "OBJECT",
    properties: {
      x_thread: A("سلسلة تغريدات لمنصة X (4-6 تغريدات، كل واحدة أقل من 270 حرفاً)"),
      linkedin_post: S("منشور مهني لـ LinkedIn"),
      instagram_caption: S("نص منشور إنستقرام قصير وجذاب"),
      hashtags: A("وسوم مناسبة بدون علامة #"),
    },
    required: ["x_thread", "linkedin_post", "instagram_caption", "hashtags"],
  },
};

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

async function callGemini(pdfB64: string, types: OutType[]) {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new Error("مفتاح Gemini غير مضاف بعد");

  const properties: Record<string, unknown> = {
    suggested_sectors: A("القطاعات المجتمعية الأنسب للاستفادة من البحث، من هذه القائمة فقط: education, health, nonprofit, government, social, environment, economy, culture, technology, youth"),
  };
  for (const t of types) properties[t] = SCHEMAS[t];

  const prompt = `أنت خبير في تحويل الأبحاث العلمية إلى مخرجات تطبيقية تخدم المجتمع.
اقرأ البحث المرفق كاملاً، ثم أنتج المخرجات المطلوبة فقط.
القواعد:
- اكتب بالعربية الفصحى الواضحة حتى لو كان البحث بالإنجليزية.
- التزم بما ورد في البحث فقط؛ لا تخترع أرقاماً أو نتائج أو أسماء غير موجودة فيه.
- خاطب غير المتخصصين بلغة مبسطة دون الإخلال بالدقة العلمية.
- لا تذكر اسم الباحث أو بياناته الشخصية.`;

  const body = {
    contents: [{ role: "user", parts: [{ inline_data: { mime_type: "application/pdf", data: pdfB64 } }, { text: prompt }] }],
    generationConfig: {
      temperature: 0.4,
      responseMimeType: "application/json",
      responseSchema: { type: "OBJECT", properties, required: Object.keys(properties) },
    },
  };

  const models = [Deno.env.get("GEMINI_MODEL"), "gemini-flash-latest", "gemini-2.5-flash"].filter(Boolean) as string[];
  let lastErr = "";
  for (const model of models) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
    });
    if (res.status === 404) { lastErr = `model ${model} not found`; continue; }
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 429) throw new Error("تم تجاوز الحد المجاني المؤقت، حاول بعد دقيقة");
      throw new Error(data?.error?.message ?? `Gemini error ${res.status}`);
    }
    const text = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("");
    if (!text) throw new Error("لم يرجع الذكاء الاصطناعي أي نص");
    return JSON.parse(text);
  }
  throw new Error(lastErr || "تعذر الوصول إلى نموذج Gemini");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "غير مسجل الدخول" }, 401);

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { research_id } = await req.json().catch(() => ({}));
  if (!research_id) return json({ error: "رقم البحث مفقود" }, 400);

  const { data: research } = await admin.from("research").select("*")
    .eq("id", research_id).eq("user_id", user.id).maybeSingle();
  if (!research) return json({ error: "البحث غير موجود" }, 404);
  if (research.status !== "uploaded") return json({ error: "تمت معالجة هذا البحث مسبقاً" }, 409);

  const types = (research.requested_types as string[]).filter((t): t is OutType => (ALLOWED as readonly string[]).includes(t));
  if (!types.length) return json({ error: "لم يتم اختيار أي مخرج" }, 400);

  const path = `${user.id}/${research.id}.pdf`;
  await admin.from("research").update({ status: "processing" }).eq("id", research.id);

  try {
    const { data: file, error: dlErr } = await admin.storage.from("papers").download(path);
    if (dlErr || !file) throw new Error("تعذر قراءة ملف البحث");
    const b64 = toBase64(new Uint8Array(await file.arrayBuffer()));

    const result = await callGemini(b64, types);
    const rows = types.filter((t) => result[t]).map((t) => ({
      research_id: research.id,
      user_id: user.id,
      type: t,
      content: { ...result[t], suggested_sectors: result.suggested_sectors ?? [] },
    }));
    if (!rows.length) throw new Error("لم تُولد أي مخرجات");
    const { error: insErr } = await admin.from("outputs").insert(rows);
    if (insErr) throw new Error(insErr.message);

    await admin.storage.from("papers").remove([path]);
    await admin.from("research").update({ status: "done", file_deleted: true, error: null }).eq("id", research.id);
    return json({ ok: true, count: rows.length });
  } catch (e) {
    // الخصوصية أولاً: نحذف الملف حتى عند الفشل
    await admin.storage.from("papers").remove([path]);
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from("research").update({ status: "failed", file_deleted: true, error: msg }).eq("id", research.id);
    return json({ error: msg }, 500);
  }
});
