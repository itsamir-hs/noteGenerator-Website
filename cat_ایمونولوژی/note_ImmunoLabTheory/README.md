# جزوه‌ساز — Note Renderer

جزوه‌ساز (Note Renderer) یک ابزار برای تبدیل محتوای آموزشی ساختاریافته در قالب Markdown به یک جزوه HTML خوانا، واکنش‌گرا و قابل شخصی‌سازی است.

این پروژه بخشی از یک pipeline بزرگ‌تر برای تبدیل محتوای خام آموزشی، صوت و اسلایدهای کلاس به جزوه است.

---

## ✨ قابلیت‌ها

### پردازش محتوا

* تبدیل Markdown به HTML
* پشتیبانی از زبان فارسی و RTL
* پشتیبانی از فرمول‌های ریاضی با KaTeX
* پردازش و مدیریت مسیر تصاویر
* پاک‌سازی و Sanitization خروجی HTML
* تشخیص و نمایش Definition Box
* پشتیبانی از ساختارهای مختلف برای تعریف‌ها
* تبدیل جعبه‌های فراخوانی `> [!TYPE]` به باکس‌های رنگی (Callout Boxes)

### Navigation

* ساخت خودکار Table of Contents
* Quick Navigation بین بخش‌های جزوه
* Sidebar برای دسترسی سریع به بخش‌ها
* نمایش بخش فعال هنگام Scroll
* سازگاری Navigation با تغییرات DOM پس از جست‌وجو

### Search

* جست‌وجوی سریع در محتوای جزوه
* نمایش تعداد نتایج
* رفتن به نتیجه بعدی و قبلی
* مشخص کردن نتیجه فعال
* میانبر `Ctrl + F`
* پاک کردن سریع جست‌وجو

### Highlight

* Highlight کردن متن انتخاب‌شده
* چند رنگ آماده
* انتخاب رنگ دلخواه
* فعال و غیرفعال کردن Highlight
* حالت پاک‌کن
* ذخیره Highlightها در `localStorage`
* بازیابی Highlightها پس از باز کردن مجدد جزوه

### ظاهر و شخصی‌سازی

* تغییر اندازه فونت
* چند Theme مختلف
* طراحی Responsive
* حالت مناسب برای چاپ
* پنجره معرفی پروژه و اعضای تیم
* نمایش اطلاعات درس و جلسه
* هشدار درباره تولید محتوای هوش مصنوعی

---

## 🎨 Themeها

جزوه‌ساز از CSS Variables برای مدیریت Themeها استفاده می‌کند.

Themeهای فعلی:

| Theme      | وضعیت |
| ---------- | ----- |
| Light      | ✅     |
| Dark       | ✅     |
| Forest     | ✅     |
| Paper Like | ✅     |
| Neon       | ✅     |

Theme فعال از طریق `data-theme` روی عنصر `<html>` مشخص می‌شود:

```html
<html data-theme="dark">
```

Themeها بدون تغییر در ساختار اصلی HTML می‌توانند ظاهر و رنگ‌های رابط کاربری را تغییر دهند.

---

## 🧱 ساختار پروژه

```text
note_renderer/
│
├── config/
│   └── renderer_config.json
│
├── data/
│   └── input/
│       └── note.md
│
├── output/
│   └── index.html
│
├── src/
│   ├── main.js
│   ├── parser.js
│   ├── renderer.js
│   ├── callouts.js
│   ├── tableOfContents.js
│   ├── quickNavigation.js
│   ├── search.js
│   ├── highlight.js
│   ├── themeSwitcher.js
│   ├── fontSizeSwitcher.js
│   ├── aboutModal.js
│   ├── math_renderer.js
│   └── image_handler.js
│
├── styles/
│   ├── base.css
│   ├── rtl.css
│   ├── responsive.css
│   ├── dark.css
│   ├── forest.css
│   ├── paperLike.css
│   └── neon.css
│
├── templates/
│   └── note.html
│
├── tests/
│
├── package.json
├── package-lock.json
└── README.md
```

---

## ⚙️ نصب

ابتدا وارد پروژه شوید:

```bash
cd ~/note_renderer/Bashligh/note_renderer
```

سپس وابستگی‌ها را نصب کنید:

```bash
npm install
```

---

## ▶️ اجرای پروژه

برای تولید جزوه:

```bash
cd ~/note_renderer/Bashligh/note_renderer
node src/main.js
```

در صورت موفقیت، خروجی در مسیر زیر تولید می‌شود:

```text
output/index.html
```

برای باز کردن خروجی در مرورگر:

```bash
cd ~/note_renderer/Bashligh/note_renderer
xdg-open output/index.html
```

---

## 📝 ورودی Markdown

فایل ورودی اصلی:

```text
data/input/note.md
```

ساختار پیشنهادی جزوه:

```markdown
# عنوان جزوه

**درس:** نام درس  
**مبحث:** موضوع جلسه  
**استاد:** نام استاد  
**تاریخ جلسه:** تاریخ  
**تاریخ تولید جزوه:** تاریخ

## ۱. مقدمه و کلیات

محتوای مقدمه...

## ۲. متن اصلی جزوه

محتوای اصلی...

## ۳. تعاریف

- **Term:** توضیح اصطلاح

## ۴. نکات مهم

نکات مهم...

## ۵. مثال‌ها

مثال‌ها...

## ۶. جداول مرور سریع

جداول...

## ۷. اصطلاحات و تعاریف کلیدی

### Term

توضیح اصطلاح...

## ۸. موارد نیازمند بررسی

مواردی که نیاز به بررسی دارند...

## ۹. منابع و مراجع

منابع...

## ۱۰. گزارش تکمیل بودن محتوا

گزارش نهایی...
```

---

## 📦 Definition Box

Renderer می‌تواند تعریف‌ها را به‌صورت خودکار به Definition Box تبدیل کند.

برای مثال:

```markdown
> **تعریف — Lumen**
> فضای داخلی یک ساختار لوله‌ای عروقی.
```

یا در بخش تعاریف:

```markdown
## ۳. تعاریف

- **Lumen:** فضای داخلی ساختارهای لوله‌ای عروقی.
- **Mineralization:** معدنی‌شدن یک ناحیه تحت شرایط مشخص.
```

یا در بخش اصطلاحات:

```markdown
## ۷. اصطلاحات و تعاریف کلیدی

### Lumen

فضای داخلی ساختارهای لوله‌ای عروقی.

### Mineralization

معدنی‌شدن یک ناحیه تحت شرایط مشخص.
```

Renderer این ساختارها را تشخیص داده و به Definition Box تبدیل می‌کند.

---

## 🔄 Pipeline

فرآیند کلی تولید جزوه:

```text
Markdown
   │
   ▼
Parser
   │
   ▼
Markdown → HTML
   │
   ├── Math Processing
   ├── Definition Detection
   ├── Image Path Resolution
   ├── HTML Sanitization
   │
   ▼
Table of Contents
   │
   ▼
Template
   │
   ▼
output/index.html
```

---

## 🧩 اجزای اصلی

### `main.js`

نقطه شروع اجرای Renderer است و مراحل اصلی تولید خروجی را مدیریت می‌کند.

وظایف اصلی:

* خواندن فایل Markdown
* خواندن تنظیمات Renderer
* اجرای Markdown Renderer
* استخراج بخش‌های اصلی جزوه
* ساخت Table of Contents
* قرار دادن محتوا در Template
* تولید فایل نهایی

---

### `parser.js`

وظیفه تبدیل Markdown به HTML را بر عهده دارد.

برای Markdown Parsing از `marked` استفاده شده است.

---

### `renderer.js`

لایه پردازش اصلی بین Markdown Parser و خروجی نهایی است.

وظایف:

* اجرای Markdown parsing
* پردازش فرمول‌های ریاضی
* تشخیص Definition Box
* مدیریت مسیر تصاویر
* HTML Sanitization

---

### `tableOfContents.js`

Headingهای جزوه را شناسایی کرده و ساختار Table of Contents را ایجاد می‌کند.

---

### `quickNavigation.js`

Navigation سریع بین بخش‌های جزوه را مدیریت می‌کند.

این بخش به‌صورت پویا Sectionهای فعلی را دریافت می‌کند تا پس از تغییر DOM، مانند عملیات Search، Navigation همچنان درست کار کند.

---

### `search.js`

سیستم جست‌وجوی داخل جزوه را مدیریت می‌کند.

قابلیت‌ها:

* جست‌وجوی متن
* Highlight نتایج
* نتیجه بعدی و قبلی
* شمارش نتایج
* Clear کردن جست‌وجو
* پشتیبانی از `Ctrl + F`

---

### `highlight.js`

سیستم Highlight متن را مدیریت می‌کند.

قابلیت‌ها:

* رنگ‌های آماده
* رنگ دلخواه
* فعال/غیرفعال کردن Highlight
* پاک‌کن
* ذخیره Highlight
* بازیابی Highlight

Highlightها در `localStorage` مرورگر ذخیره می‌شوند.

---

### `themeSwitcher.js`

مسئول تغییر Theme رابط کاربری است.

Theme فعال با attribute زیر مشخص می‌شود:

```html
<html data-theme="dark">
```

---

### `fontSizeSwitcher.js`

اندازه فونت محتوای جزوه را کنترل می‌کند.

---

### `math_renderer.js`

مسئول آماده‌سازی و بازیابی فرمول‌های ریاضی برای پردازش صحیح Markdown و KaTeX است.

---

### `image_handler.js`

مسیر تصاویر موجود در Markdown را با مسیر مناسب خروجی هماهنگ می‌کند.

---

## 📐 Responsive Design

رابط کاربری برای اندازه‌های مختلف صفحه طراحی شده است.

### Desktop

تمرکز روی:

* Sidebar
* Quick Navigation
* محتوای اصلی
* کنترل‌های Header

### Tablet

عناصر جانبی برای استفاده بهتر از فضای صفحه کاهش پیدا می‌کنند.

### Mobile

رابط کاربری به حالت compact تغییر می‌کند:

* کنترل‌های کوچک‌تر
* Sidebar مناسب صفحه کوچک
* جدول‌های قابل اسکرول
* Modal سازگار با صفحه
* Typography متناسب با موبایل

Breakpoints اصلی:

```text
900px
600px
450px
```

---

## 🖨️ Print Support

جزوه قابلیت چاپ مستقیم دارد.

تنظیمات چاپ در CSS به‌گونه‌ای طراحی شده‌اند که Theme و رنگ‌های مهم محتوا تا حد امکان در خروجی چاپ حفظ شوند.

---

## 📚 تکنولوژی‌ها

این پروژه از تکنولوژی‌های زیر استفاده می‌کند:

* HTML5
* CSS3
* JavaScript
* Node.js
* Markdown
* Marked
* KaTeX
* DOMPurify
* JSDOM
* Lucide Icons

---

## 🔌 رندر به‌صورت کتابخانه‌ای (API)

`src/main.js` علاوه بر اجرای CLI (`node src/main.js`)، یک تابع قابل import هم ارائه می‌دهد تا ابزارهای دیگر (مثل داشبورد ویرایش انسانی) خروجی رندر دقیقاً یکسان تولید کنند:

```javascript
import { renderNoteHtml } from "./src/main.js";

const { html, title, metadata, tocItems } = renderNoteHtml(markdownContent, {
    template,            // محتوای templates/note.html
    rendererConfig       // { theme, language, enableMath } از config/renderer_config.json
});
```

نکات:

* `renderNoteHtml` هیچ فایلی را نمی‌نویسد و هیچ اثر جانبی ندارد؛ فقط HTML نهایی را برمی‌گرداند.
* بخش‌های قالب با ترتیب **عنوان → شمارهٔ ابتدای عنوان → ترتیب مکانی** نگاشت می‌شوند، بنابراین تغییر نام یک عنوان باعث حذف محتوا نمی‌شود. بخش‌های اضافی به انتهای `mainContent` اضافه می‌شوند.
* مقدار `rendererConfig.theme` در خصیصهٔ `data-theme` خروجی اعمال می‌شود.

## 📦 جعبه‌های فراخوانی (Callout Boxes)

ماژول `src/callouts.js` بدون وابستگی خارجی است و هم در رندر کنندهٔ Bashligh و هم در داشبورد ویرایش استفاده می‌شود:

```javascript
import { applyCallouts, CALLOUT_TYPES, getCalloutLabel, normalizeCalloutType } from "./callouts.js";
```

نگارش‌های پشتیبانی‌شده در Markdown:

```markdown
> **تعریف — یک سلول**     ← باکس موجود Definition Box (بدون تغییر)
> پاسخ جزئی

> [!IMPORTANT] نکته مهم
>
> بدنهٔ جعبه
```

انواع: `note`، `tip`، `important`، `warning`، `caution`، `definition`، `example`، `exam-tip`، `key-point`، `review`، `custom`

خروجی به شکل زیر است:

```html
<div class="calloutBox calloutBox--important" data-callout="important">
    <p class="calloutBoxTitle">نکته مهم</p>
    <p>بدنهٔ جعبه</p>
</div>
```

رنگ هر نوع از متغیرهای موجود در `styles/base.css` (`--importantColor`، `--warningColor`، …) استفاده می‌کند.

---

## 👥 اعضای تیم

| عضو                             | مسئولیت                                   |
| ------------------------------- | ----------------------------------------- |
| شبنم رضاپور                     | استخراج فایل‌ها                           |
| امیر حسین شکری‌زاده سعادت‌آبادی | پردازش صوت و ویدیو                        |
| مهراد اسدی                      | Prompt Engineering و پردازش با هوش مصنوعی |
| امیر سالار سهام‌پور             | Frontend و طراحی رابط کاربری              |

---

## 🧠 معماری کلی پروژه

```text
Input / Extraction
        │
        ▼
Audio & Video Processing
        │
        ▼
AI Processing
        │
        ▼
Markdown
        │
        ▼
Note Renderer
        │
        ▼
HTML Note
```

---

## 🛠️ Naming Convention

نام‌گذاری کد پروژه از قوانین زیر پیروی می‌کند.

### Functions

```text
get...
set...
fetch...
create...
update...
delete...
validate...
calculate...
```

### Boolean

```text
is...
can...
has...
should...
```

### General

* استفاده از `lowerCamelCase`
* استفاده از نام‌های انگلیسی
* حداقل تعداد کلمات ممکن
* پرهیز از abbreviationهای نامشخص
* استفاده از نام‌های self-explanatory
* ترجیح نام‌های دقیق و قابل فهم به نام‌های کوتاه و مبهم

---

## 🚧 وضعیت پروژه

پروژه در حال توسعه است.

### Completed

* [x] Markdown Renderer
* [x] RTL Layout
* [x] Metadata
* [x] Table of Contents
* [x] Sidebar
* [x] Quick Navigation
* [x] Search
* [x] Text Highlight
* [x] Definition Boxes
* [x] Font Size Control
* [x] Theme Switcher
* [x] Light Theme
* [x] Dark Theme
* [x] Forest Theme
* [x] Paper Like Theme
* [x] Neon Theme
* [x] About Modal
* [x] Responsive Layout
* [x] Print Support

### Planned

* [ ] بهبود سیستم Navigation
* [ ] تست‌های خودکار بیشتر
* [ ] مدیریت بهتر خطاها
* [ ] پشتیبانی از ورودی‌های متنوع‌تر
* [ ] بهبود پردازش محتوای آموزشی
* [ ] رابط کاربری کامل‌تر برای تولید جزوه

---

## 📄 License

این پروژه در حال توسعه برای استفاده و آزمایش تیمی است.

جزئیات License در آینده مشخص خواهد شد.

---

## 💡 هدف نهایی

جزوه‌ساز قرار نیست فقط یک Markdown Renderer باشد.

هدف نهایی پروژه ساخت یک pipeline کامل برای تبدیل محتوای خام آموزشی به جزوه‌ای:

* ساختاریافته
* خوانا
* قابل مرور
* قابل شخصی‌سازی
* مناسب برای مطالعه

است.

```text
Raw Educational Content
          ↓
      Processing
          ↓
    AI Assistance
          ↓
       Markdown
          ↓
    Note Renderer
          ↓
  Structured Note
          ↓
   Better Learning
```
