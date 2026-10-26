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

const ALLOWED = ["policy_brief", "poster", "social", "training_kit"] as const;
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
  training_kit: {
    type: "OBJECT",
    properties: {
      title: S("عنوان البرنامج التدريبي"),
      target_group: S("الفئة المستهدفة بالتدريب"),
      rationale: S("مبررات البرنامج: لماذا تحتاج هذه الفئة هذا التدريب بناءً على نتائج البحث"),
      general_objective: S("الهدف العام للبرنامج"),
      learning_outcomes: A("نواتج التعلم المتوقعة: يكون المتدرب قادراً على... (4-6)"),
      duration: S("المدة الإجمالية المقترحة، مثل: يومان تدريبيان بواقع 4 ساعات يومياً"),
      sessions: {
        type: "ARRAY",
        description: "الجلسات التدريبية (3-6 جلسات)",
        items: {
          type: "OBJECT",
          properties: {
            title: S("عنوان الجلسة"),
            duration: S("مدة الجلسة"),
            objectives: A("أهداف الجلسة"),
            content: A("المحتوى العلمي الرئيسي للجلسة مستنداً إلى البحث"),
            activities: A("أنشطة تدريبية تفاعلية (مثل: نقاش، دراسة حالة، لعب أدوار، ورشة عمل)"),
          },
          required: ["title", "duration", "objectives", "content", "activities"],
        },
      },
      evaluation: A("أساليب تقييم أثر التدريب"),
      materials: A("المواد والأدوات المطلوبة للتدريب"),
      trainer_notes: S("إرشادات للمدرب لتطبيق البرنامج بفاعلية"),
    },
    required: ["title", "target_group", "rationale", "general_objective", "learning_outcomes", "duration", "sessions", "evaluation", "materials", "trainer_notes"],
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

async function callGemini(pdfB64: string, types: OutType[], audience: string | null, ownerName: string) {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new Error("مفتاح Gemini غير مضاف بعد");

  const properties: Record<string, unknown> = {
    suggested_sectors: A("القطاعات المجتمعية الأنسب للاستفادة من البحث، من هذه القائمة فقط: education, health, nonprofit, government, social, environment, economy, culture, technology, youth"),
  };
  properties.author_check = {
    type: "OBJECT",
    properties: {
      authors: A("أسماء مؤلفي البحث كما وردت في الغلاف أو الصفحة الأولى"),
      name_match: { type: "STRING", enum: ["match", "no_match", "unclear"], description: "هل صاحب الحساب أحد المؤلفين؟" },
    },
    required: ["authors", "name_match"],
  };
  for (const t of types) properties[t] = SCHEMAS[t];

  const prompt = `أنت خبير في تحويل الأبحاث العلمية إلى مخرجات تطبيقية تخدم المجتمع.
اقرأ البحث المرفق كاملاً، ثم أنتج المخرجات المطلوبة فقط.
القواعد:
- اكتب بالعربية الفصحى الواضحة حتى لو كان البحث بالإنجليزية.
- التزم بما ورد في البحث فقط؛ لا تخترع أرقاماً أو نتائج أو أسماء غير موجودة فيه.
- خاطب غير المتخصصين بلغة مبسطة دون الإخلال بالدقة العلمية.
- لا تذكر اسم الباحث أو بياناته الشخصية داخل المخرجات.
- التحقق من الملكية (author_check): اسم صاحب الحساب هو «${ownerName.slice(0, 120)}». استخرج أسماء المؤلفين من الغلاف أو الصفحة الأولى، ثم حدّد name_match:
  match إذا كان صاحب الحساب أحد المؤلفين (مع مراعاة اختلاف الكتابة بين العربية والإنجليزية، واختصار الاسم، وترتيب الاسم الأول والعائلة)؛
  no_match إذا كانت أسماء المؤلفين واضحة وليس صاحب الحساب بينهم؛
  unclear إذا لم يتضمن الملف أسماء مؤلفين واضحة.${types.includes("training_kit") ? (audience
    ? `\n- الحقيبة التدريبية موجّهة تحديداً إلى هذه الفئة: «${audience.slice(0, 200)}»؛ صمّم المحتوى والأنشطة بما يناسبها.`
    : `\n- حدّد أنسب فئة مستهدفة للحقيبة التدريبية بناءً على نتائج البحث وتوصياته.`) : ""}`;

  const body = {
    contents: [{ role: "user", parts: [{ inline_data: { mime_type: "application/pdf", data: pdfB64 } }, { text: prompt }] }],
    generationConfig: {
      temperature: 0.4,
      responseMimeType: "application/json",
      responseSchema: { type: "OBJECT", properties, required: Object.keys(properties) },
    },
  };

  // نجرب أكثر من نموذج، ونعيد المحاولة تلقائياً عند ازدحام خوادم Google
  const models = [Deno.env.get("GEMINI_MODEL"), "gemini-flash-latest", "gemini-2.5-flash", "gemini-flash-lite-latest"].filter(Boolean) as string[];
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let busy = false, lastErr = "";
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(body),
      });
      if (res.status === 404) { lastErr = `model ${model} not found`; break; }
      const data = await res.json().catch(() => ({}));
      if ([429, 500, 503, 504].includes(res.status)) {
        busy = true; lastErr = data?.error?.message ?? `HTTP ${res.status}`;
        if (attempt === 0) await sleep(4000);
        continue;
      }
      if (!res.ok) throw new Error(data?.error?.message ?? `Gemini error ${res.status}`);
      const text = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("");
      if (!text) { lastErr = "empty response"; break; }
      return JSON.parse(text);
    }
  }
  console.error("gemini failed:", lastErr);
  if (busy) throw new Error("خدمة الذكاء الاصطناعي من Google مزدحمة حالياً (ضغط مؤقت على خوادمها). جرّب مرة أخرى بعد بضع دقائق.");
  throw new Error("تعذّر الوصول إلى خدمة الذكاء الاصطناعي حالياً. جرّب مرة أخرى لاحقاً.");
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

    const { data: profile } = await admin.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
    const result = await callGemini(b64, types, research.target_audience ?? null, profile?.full_name ?? "");
    const nameMatch = result.author_check?.name_match ?? "unclear";
    if (nameMatch === "no_match") {
      await admin.from("research").update({ name_check: "no_match" }).eq("id", research.id);
      throw new Error("لم نجد اسمك ضمن مؤلفي هذا البحث، لذلك لم يتم التحويل. جنى تحوّل أبحاث أصحابها فقط. إذا كان البحث بحثك فتأكد أن اسمك في حسابك مكتوب كما يظهر في البحث (من صفحة «أبحاثي») ثم ارفعه مرة أخرى.");
    }
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
    await admin.from("research").update({ status: "done", file_deleted: true, error: null, name_check: nameMatch, verified: nameMatch === "match" }).eq("id", research.id);
    return json({ ok: true, count: rows.length });
  } catch (e) {
    // الخصوصية أولاً: نحذف الملف حتى عند الفشل
    await admin.storage.from("papers").remove([path]);
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from("research").update({ status: "failed", file_deleted: true, error: msg }).eq("id", research.id);
    return json({ error: msg }, 500);
  }
});
