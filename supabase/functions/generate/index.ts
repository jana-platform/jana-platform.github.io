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
      limitations: A("حدود الدراسة كما وردت في البحث أو تُفهم منه بوضوح: الحدود الموضوعية والمكانية والزمانية والبشرية، وحجم العينة ونوعها، والمنهج؛ مع التنبيه إلى ما لا يصح تعميم النتائج عليه (2-5 نقاط)"),
      conclusion: S("خاتمة قصيرة"),
    },
    required: ["title", "executive_summary", "problem", "key_findings", "recommendations", "target_audience", "limitations", "conclusion"],
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
      limitations: S("تنبيه مختصر وواضح بحدود الدراسة (العينة، المكان، الزمن، المنهج) بلغة مبسطة، لإضافته مع المنشورات حتى لا تُعمَّم النتائج خارج نطاقها (جملة أو جملتان)"),
    },
    required: ["x_thread", "linkedin_post", "instagram_caption", "hashtags", "limitations"],
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

// النماذج بالترتيب: نبدأ بالأسرع والأقل ازدحاماً، ثم البدائل (تم اختبارها فعلياً)
const MODELS = [Deno.env.get("GEMINI_MODEL"), "gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-flash-latest"].filter(Boolean) as string[];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// استدعاء واحد مع إعادة المحاولة والتنقل بين النماذج، دون تجاوز المهلة
async function callModel(pdfB64: string, prompt: string, schema: unknown, deadline: number) {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new Error("مفتاح Gemini غير مضاف بعد");
  const payload = JSON.stringify({
    contents: [{ role: "user", parts: [{ inline_data: { mime_type: "application/pdf", data: pdfB64 } }, { text: prompt }] }],
    generationConfig: { temperature: 0.4, responseMimeType: "application/json", responseSchema: schema },
  });
  let lastErr = "";
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const left = deadline - Date.now();
      if (left < 15000) throw new Error("BUSY:time budget exceeded " + lastErr);
      let res: Response;
      try {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: payload,
          signal: AbortSignal.timeout(Math.min(left - 8000, 75000)),
        });
      } catch (_e) { lastErr = `${model} timeout`; break; }
      const data = await res.json().catch(() => ({}));
      if ([429, 500, 503, 504].includes(res.status)) {
        lastErr = `${model} ${res.status}`;
        if (attempt === 0 && deadline - Date.now() > 40000) { await sleep(2500); continue; }
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

const BASE_RULES = `أنت خبير في تحويل الأبحاث العلمية إلى مخرجات تطبيقية تخدم المجتمع.
اقرأ البحث المرفق كاملاً.
القواعد:
- اكتب بالعربية الفصحى الواضحة حتى لو كان البحث بالإنجليزية.
- التزم بما ورد في البحث فقط؛ لا تخترع أرقاماً أو نتائج أو أسماء غير موجودة فيه.
- خاطب غير المتخصصين بلغة مبسطة دون الإخلال بالدقة العلمية.
- لا تذكر اسم الباحث أو بياناته الشخصية داخل المخرجات.`;

const META_SCHEMA = {
  type: "OBJECT",
  properties: {
    suggested_sectors: A("القطاعات المجتمعية الأنسب للاستفادة من البحث، من هذه القائمة فقط: education, health, nonprofit, government, social, environment, economy, culture, technology, youth"),
    authors: A("أسماء مؤلفي البحث كما وردت في الغلاف أو الصفحة الأولى"),
    name_match: { type: "STRING", enum: ["match", "no_match", "unclear"], description: "هل صاحب الحساب أحد المؤلفين؟" },
  },
  required: ["suggested_sectors", "authors", "name_match"],
};

function metaPrompt(ownerName: string) {
  return `اقرأ الصفحات الأولى من البحث المرفق.
اسم صاحب الحساب هو «${ownerName.slice(0, 120)}». استخرج أسماء المؤلفين من الغلاف أو الصفحة الأولى، ثم حدّد name_match:
- match إذا كان صاحب الحساب أحد المؤلفين (مع مراعاة اختلاف الكتابة بين العربية والإنجليزية، واختصار الاسم، وترتيب الاسم الأول والعائلة)؛
- no_match إذا كانت أسماء المؤلفين واضحة وليس صاحب الحساب بينهم؛
- unclear إذا لم يتضمن الملف أسماء مؤلفين واضحة.
وحدّد القطاعات المجتمعية الأنسب للاستفادة من البحث.`;
}

const TYPE_TASK: Record<OutType, string> = {
  policy_brief: "أنتج موجز سياسات لصنّاع القرار.",
  poster: "أنتج محتوى ملصق علمي مختصر.",
  social: "أنتج محتوى للتواصل الاجتماعي بلغة جذابة مبسطة.",
  training_kit: "أنتج حقيبة تدريبية متكاملة.",
};
const TYPE_LABEL: Record<OutType, string> = {
  policy_brief: "موجز السياسات", poster: "الملصق العلمي", social: "محتوى السوشيال ميديا", training_kit: "الحقيبة التدريبية",
};

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
  const started = Date.now();
  const { research_id, cleanup } = await req.json().catch(() => ({}));
  if (!research_id) return json({ error: "رقم البحث مفقود" }, 400);

  // تنظيف بحث علِق في المعالجة (مثلاً إذا انقطعت الخدمة): نحذف ملفه ونسمح بإعادة المحاولة
  if (cleanup) {
    const { data: r } = await admin.from("research").select("id,status,created_at")
      .eq("id", research_id).eq("user_id", user.id).maybeSingle();
    if (r && ["uploaded", "processing"].includes(r.status) && Date.now() - new Date(r.created_at).getTime() > 4 * 60 * 1000) {
      await admin.storage.from("papers").remove([`${user.id}/${r.id}.pdf`]);
      await admin.from("research").update({ status: "failed", file_deleted: true,
        error: "استغرقت المعالجة وقتاً أطول من المسموح (غالباً بسبب ازدحام خدمة Google أو كِبر حجم الملف). حذفنا الملف، جرّب مرة أخرى." }).eq("id", r.id);
      return json({ ok: true, cleaned: true });
    }
    return json({ ok: true, cleaned: false });
  }

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
    const deadline = started + 120000;

    // كل منتج يتولد في طلب مستقل وبالتوازي، مع طلب صغير للتحقق من الاسم والقطاعات
    const audience = research.target_audience as string | null;
    const [metaRes, ...outRes] = await Promise.allSettled([
      callModel(b64, metaPrompt(profile?.full_name ?? ""), META_SCHEMA, deadline),
      ...types.map((t) => callModel(b64,
        `${BASE_RULES}\n\nالمطلوب: ${TYPE_TASK[t]}${t === "training_kit" ? (audience
          ? `\nالحقيبة موجّهة تحديداً إلى هذه الفئة: «${audience.slice(0, 200)}»؛ صمّم المحتوى والأنشطة بما يناسبها.`
          : "\nحدّد أنسب فئة مستهدفة للحقيبة بناءً على نتائج البحث وتوصياته.") : ""}`,
        SCHEMAS[t], deadline)),
    ]);
    outRes.forEach((r, i) => { if (r.status === "rejected") console.error("output failed", types[i], String(r.reason).slice(0, 200)); });

    const meta = metaRes.status === "fulfilled" ? metaRes.value.value : null;
    const nameMatch = meta?.name_match ?? "unclear";
    if (nameMatch === "no_match") {
      await admin.from("research").update({ name_check: "no_match" }).eq("id", research.id);
      throw new Error("لم نجد اسمك ضمن مؤلفي هذا البحث، لذلك لم يتم التحويل. جنى تحوّل أبحاث أصحابها فقط. إذا كان البحث بحثك فتأكد أن اسمك في حسابك مكتوب كما يظهر في البحث (من صفحة «أبحاثي») ثم ارفعه مرة أخرى.");
    }
    const failedTypes = types.filter((_, i) => outRes[i].status === "rejected");
    if (failedTypes.length === types.length) {
      throw new Error("خدمة الذكاء الاصطناعي من Google مزدحمة حالياً (ضغط مؤقت على خوادمها). جرّب مرة أخرى بعد بضع دقائق.");
    }
    const rows = types.map((t, i) => ({ t, r: outRes[i] }))
      .filter((x) => x.r.status === "fulfilled")
      .map(({ t, r }) => ({
        research_id: research.id,
        user_id: user.id,
        type: t,
        content: { ...(r as PromiseFulfilledResult<{ value: Record<string, unknown>; model: string }>).value.value, suggested_sectors: meta?.suggested_sectors ?? [] },
        model: (r as PromiseFulfilledResult<{ value: Record<string, unknown>; model: string }>).value.model,
      }));
    if (!rows.length) throw new Error("لم تُولد أي مخرجات");
    const { error: insErr } = await admin.from("outputs").insert(rows);
    if (insErr) throw new Error(insErr.message);

    await admin.storage.from("papers").remove([path]);
    const note = failedTypes.length
      ? `تعذّر توليد: ${failedTypes.map((t) => TYPE_LABEL[t]).join("، ")} بسبب ازدحام خدمة Google. يمكنك رفع البحث مرة أخرى واختيارها فقط.`
      : null;
    await admin.from("research").update({ status: "done", file_deleted: true, error: note, name_check: nameMatch, verified: nameMatch === "match" }).eq("id", research.id);
    return json({ ok: true, count: rows.length });
  } catch (e) {
    // الخصوصية أولاً: نحذف الملف حتى عند الفشل
    await admin.storage.from("papers").remove([path]);
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from("research").update({ status: "failed", file_deleted: true, error: msg }).eq("id", research.id);
    return json({ error: msg }, 500);
  }
});
