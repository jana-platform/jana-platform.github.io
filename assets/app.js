// ===== جنى: الإعدادات والأدوات المشتركة بين كل الصفحات =====

// الوضع الليلي: يُطبّق قبل ظهور الصفحة لتجنّب الوميض
(function () {
  let saved = null;
  try { saved = localStorage.getItem("jana-theme"); } catch {}
  const dark = saved ? saved === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
})();
function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("jana-theme", next); } catch {}
  const b = document.getElementById("themeBtn");
  if (b) b.textContent = next === "dark" ? "☀️" : "🌙";
}
// هذه المفاتيح "عامة" ومصممة لتكون في المتصفح؛ الحماية الفعلية عبر صلاحيات قاعدة البيانات.
const JANA_CONFIG = {
  supabaseUrl: "https://zzaehqhxzgnxuhjmdxoe.supabase.co",
  supabaseKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp6YWVocWh4emdueHVoam1keG9lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIyNTk1MjksImV4cCI6MjEwNzgzNTUyOX0.D-Tak-E5SYC2A6peZnHcJxsmiA8D0GIRirPYmYFySWk",
};

// رابط استعادة كلمة المرور من الإيميل: أياً كانت الصفحة التي فتحها، نوجّهه لصفحة تعيين كلمة المرور
if (/type=recovery/.test(location.hash) && !location.pathname.endsWith("reset.html")) {
  location.replace("reset.html" + location.hash);
}

const sb = window.supabase.createClient(JANA_CONFIG.supabaseUrl, JANA_CONFIG.supabaseKey);

const OUTPUT_TYPES = {
  policy_brief: { label: "موجز سياسات", icon: "📄", desc: "ورقة مختصرة لصناع القرار بالنتائج والتوصيات" },
  poster: { label: "ملصق علمي", icon: "🖼️", desc: "ملخص بصري للبحث جاهز للعرض والطباعة" },
  social: { label: "محتوى سوشيال ميديا", icon: "💬", desc: "سلسلة X ومنشور LinkedIn ونص إنستقرام" },
  training_kit: { label: "حقيبة تدريبية", icon: "🎓", desc: "برنامج تدريبي بجلسات وأنشطة موجّه لفئة محددة" },
};

const SITE_URL = "jana-platform.github.io";
const SIGN_TEXT = "أُعدّ عبر منصة جَنى لتثمير البحث العلمي";

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

// الشعار: كتاب مفتوح تطلع منه نخلة وتحتها تمر (جَنى)
const LOGO = `<img src="assets/logo.svg" alt="" aria-hidden="true">`;

// توقيع جنى الذي يظهر أسفل كل مخرج (وفي ملف PDF)
const SIGN = `<div class="jana-sign"><img src="assets/logo.svg" alt=""><div><b>${SIGN_TEXT}</b><span dir="ltr">${SITE_URL}</span></div></div>`;

function fmtDate(d) {
  try { return new Date(d).toLocaleDateString("ar-SA-u-ca-gregory", { year: "numeric", month: "long", day: "numeric" }); }
  catch { return d; }
}

// رسم الهيدر والفوتر وشريط التجربة
async function renderChrome(active) {
  const { data: { session } } = await sb.auth.getSession();
  const dir = `<a href="directory.html" class="${active === "directory" ? "active" : ""}">دليل الجهات</a>`;
  const themeBtn = `<button class="linklike theme-btn" id="themeBtn" title="الوضع الليلي / النهاري" aria-label="تبديل الوضع الليلي">${document.documentElement.dataset.theme === "dark" ? "☀️" : "🌙"}</button>`;
  const links = session
    ? `<a href="dashboard.html" class="${active === "dashboard" ? "active" : ""}">أبحاثي</a>
       <a href="upload.html" class="${active === "upload" ? "active" : ""}">رفع بحث</a>
       ${dir}
       <a href="privacy.html" class="${active === "privacy" ? "active" : ""}">الخصوصية</a>
       <button class="linklike" id="logoutBtn">خروج</button>${themeBtn}`
    : `<a href="index.html" class="${active === "home" ? "active" : ""}">الرئيسية</a>
       ${dir}
       <a href="privacy.html" class="${active === "privacy" ? "active" : ""}">الخصوصية</a>
       <a href="auth.html" class="${active === "auth" ? "active" : ""}">دخول / تسجيل</a>${themeBtn}`;

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

  document.getElementById("themeBtn").addEventListener("click", toggleTheme);

  // رابط لوحة الإدارة يظهر للمشرفة فقط
  if (session) {
    sb.rpc("is_admin").then(({ data }) => {
      if (data) document.getElementById("logoutBtn")?.insertAdjacentHTML("beforebegin",
        `<a href="admin.html" class="${active === "admin" ? "active" : ""}">📊 لوحة الإدارة</a>`);
    });
  }
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

// ===== دليل الجهات =====
// تسجيل ضغطة (بدون أي بيانات عن الشخص) لإحصاءات لوحة الإدارة
function logOrgClick(orgId, kind) {
  sb.from("org_clicks").insert({ org_id: orgId, kind }).then(() => {}, () => {});
}

function orgCard(o) {
  const host = (() => { try { return new URL(o.website).hostname.replace(/^www\./, ""); } catch { return o.website; } })();
  return `<article class="card org-card">
    <h3><a href="org.html?id=${o.id}">${esc(o.name)}</a></h3>
    <p class="muted small">${esc(o.description)}</p>
    <div class="org-tags">${(o.sectors || []).map((s) => `<span class="chip">${SECTORS[s] || esc(s)}</span>`).join("")}</div>
    <div class="org-foot">
      <span class="small muted">📍 ${esc(o.city)}</span>
      <a class="btn ghost sm" href="${esc(o.website)}" target="_blank" rel="noopener" data-org="${o.id}">🔗 ${esc(host)}</a>
    </div>
  </article>`;
}

// أي رابط موقع جهة يُحسب كضغطة
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-org]");
  if (a) logOrgClick(a.dataset.org, "website");
});
