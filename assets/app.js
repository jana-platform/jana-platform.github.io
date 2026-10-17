// ===== جنى: الإعدادات والأدوات المشتركة بين كل الصفحات =====
// هذه المفاتيح "عامة" ومصممة لتكون في المتصفح؛ الحماية الفعلية عبر صلاحيات قاعدة البيانات.
const JANA_CONFIG = {
  supabaseUrl: "https://zzaehqhxzgnxuhjmdxoe.supabase.co",
  supabaseKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp6YWVocWh4emdueHVoam1keG9lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIyNTk1MjksImV4cCI6MjEwNzgzNTUyOX0.D-Tak-E5SYC2A6peZnHcJxsmiA8D0GIRirPYmYFySWk",
};

const sb = window.supabase.createClient(JANA_CONFIG.supabaseUrl, JANA_CONFIG.supabaseKey);

const OUTPUT_TYPES = {
  policy_brief: { label: "موجز سياسات", icon: "📄", desc: "ورقة مختصرة لصناع القرار بالنتائج والتوصيات" },
  poster: { label: "ملصق علمي", icon: "🖼️", desc: "ملخص بصري للبحث جاهز للعرض والطباعة" },
  social: { label: "محتوى سوشيال ميديا", icon: "💬", desc: "سلسلة X ومنشور LinkedIn ونص إنستقرام" },
};

const SECTORS = {
  education: "التعليم", health: "الصحة", nonprofit: "القطاع غير الربحي", government: "القطاع الحكومي",
  social: "التنمية الاجتماعية", environment: "البيئة", economy: "الاقتصاد وريادة الأعمال",
  culture: "الثقافة", technology: "التقنية والابتكار", youth: "الشباب",
};

const STATUS = {
  uploaded: "بانتظار المعالجة", processing: "جارٍ التحويل", done: "جاهز", failed: "تعذّر التحويل",
};

// حماية النصوص من أي أكواد
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const LOGO = `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 44V22" stroke="#3E7F5A" stroke-width="3" stroke-linecap="round" fill="none"/><path d="M24 30c-8 0-13-5-14-12 7 0 13 4 14 12z" fill="#3E7F5A"/><path d="M24 26c6 0 10-4 11-10-6 0-10 3-11 10z" fill="#7FB394"/><circle cx="24" cy="12" r="8" fill="#7059B3"/><circle cx="21" cy="9.5" r="2.2" fill="#C9BCEB"/></svg>`;

function fmtDate(d) {
  try { return new Date(d).toLocaleDateString("ar-SA-u-ca-gregory", { year: "numeric", month: "long", day: "numeric" }); }
  catch { return d; }
}

// رسم الهيدر والفوتر وشريط التجربة
async function renderChrome(active) {
  const { data: { session } } = await sb.auth.getSession();
  const links = session
    ? `<a href="dashboard.html" class="${active === "dashboard" ? "active" : ""}">أبحاثي</a>
       <a href="upload.html" class="${active === "upload" ? "active" : ""}">رفع بحث</a>
       <a href="privacy.html" class="${active === "privacy" ? "active" : ""}">الخصوصية</a>
       <button class="linklike" id="logoutBtn">خروج</button>`
    : `<a href="index.html" class="${active === "home" ? "active" : ""}">الرئيسية</a>
       <a href="privacy.html" class="${active === "privacy" ? "active" : ""}">الخصوصية</a>
       <a href="auth.html" class="${active === "auth" ? "active" : ""}">دخول / تسجيل</a>`;

  document.body.insertAdjacentHTML("afterbegin", `
    <div class="beta-bar">🧪 جنى في <b>نسخة تجريبية</b> حالياً، والحماية والمزايا ستتطور تدريجياً. <a href="privacy.html">اعرف أكثر</a></div>
    <header class="site-header"><div class="container">
      <a class="brand" href="index.html">${LOGO}<div><b>جَنى</b><span>لتثمير البحث العلمي</span></div></a>
      <nav class="nav">${links}</nav>
    </div></header>`);

  document.body.insertAdjacentHTML("beforeend", `
    <footer class="site-footer"><div class="container">
      <span>© ${new Date().getFullYear()} جَنى — لتثمير البحث العلمي · نسخة تجريبية</span>
      <span><a href="privacy.html">الخصوصية</a></span>
    </div></footer>`);

  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    await sb.auth.signOut();
    location.href = "index.html";
  });
  return session;
}

// الصفحات الخاصة: تحويل غير المسجّل لصفحة الدخول
async function requireAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { location.replace("auth.html"); throw new Error("redirect"); }
  return session;
}

function showAlert(el, type, msg) {
  el.className = `alert ${type}`;
  el.innerHTML = msg;
  el.classList.remove("hidden");
}

// رسائل أخطاء الدخول بالعربي
function arError(err) {
  const m = (err?.message || String(err)).toLowerCase();
  if (m.includes("invalid login")) return "الإيميل أو كلمة المرور غير صحيحة.";
  if (m.includes("email not confirmed")) return "لم يتم تأكيد الإيميل بعد. افتح بريدك واضغط رابط التأكيد.";
  if (m.includes("already registered") || m.includes("already been registered")) return "هذا الإيميل مسجّل مسبقاً. جرّب تسجيل الدخول.";
  if (m.includes("password") && m.includes("6")) return "كلمة المرور لازم تكون 6 أحرف أو أكثر.";
  if (m.includes("rate limit")) return "محاولات كثيرة، انتظر قليلاً ثم حاول مرة أخرى.";
  return err?.message || "حدث خطأ غير متوقع.";
}
