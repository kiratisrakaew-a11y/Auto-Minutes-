# คู่มือติดตั้ง Auto Minute (Google Apps Script)

ระบบนี้จัดโค้ดแบบ **copy-paste** เข้า Apps Script editor (ไม่ใช้ clasp)
ทำตามขั้นตอนด้านล่างครั้งเดียวก็ใช้งานได้

---

## 1. เตรียม Google Sheet (Database)

1. สร้าง Google Sheet เปล่า 1 อัน (ตั้งชื่อเช่น `AutoMinute DB`)
2. คัดลอก **Sheet ID** จาก URL:
   `https://docs.google.com/spreadsheets/d/`**`<SHEET_ID>`**`/edit`
   เก็บไว้ใช้ในขั้นตอนที่ 3

> ไม่ต้องสร้าง sheet ย่อยเอง — ระบบจะสร้าง `USERS / TEMPLATES / TEMPLATE_AGENDAS /
> MEETING_JOBS / MEETING_TOPICS / AUDIT_LOG` ให้อัตโนมัติในขั้นตอนที่ 4

---

## 2. สร้างโปรเจกต์ Apps Script + วางไฟล์

1. ไปที่ https://script.google.com → **New project**
2. ตั้งชื่อโปรเจกต์ `Auto Minute`
3. สร้างไฟล์ตามตารางนี้ให้ครบ แล้ววางเนื้อหาจากโฟลเดอร์ `src/`

### ไฟล์ Script (`.gs`) — New → Script
| ตั้งชื่อไฟล์ใน editor | วางเนื้อหาจาก |
|---|---|
| `Config` | `src/Config.gs` |
| `Utils` | `src/Utils.gs` |
| `SheetService` | `src/SheetService.gs` |
| `AuthService` | `src/AuthService.gs` |
| `AuditService` | `src/AuditService.gs` |
| `TemplateService` | `src/TemplateService.gs` |
| `TranscriptService` | `src/TranscriptService.gs` |
| `MeetingJobService` | `src/MeetingJobService.gs` |
| `AgendaService` | `src/AgendaService.gs` |
| `ValidationService` | `src/ValidationService.gs` |
| `GeminiService` | `src/GeminiService.gs` |
| `GoogleDocsService` | `src/GoogleDocsService.gs` |
| `Code` | `src/Code.gs` |

### ไฟล์ HTML — New → HTML
> **สำคัญ:** ตั้งชื่อไฟล์ HTML ให้ตรงตามคอลัมน์ซ้าย (ไม่มี `.html`)
> โดยเฉพาะ `app.js` (ในโฟลเดอร์ชื่อ `app.js.html`)

| ตั้งชื่อไฟล์ใน editor | วางเนื้อหาจาก |
|---|---|
| `index` | `src/index.html` |
| `styles` | `src/styles.html` |
| `template-selection` | `src/template-selection.html` |
| `meeting-setup` | `src/meeting-setup.html` |
| `agenda-mapping` | `src/agenda-mapping.html` |
| `transcript-preview` | `src/transcript-preview.html` |
| `summary-review` | `src/summary-review.html` |
| `app.js` | `src/app.js.html` |

### Manifest
- เปิด **Project Settings** (⚙️) → ติ๊ก **Show "appsscript.json" manifest file**
- เปิดไฟล์ `appsscript.json` แล้ววางเนื้อหาจาก `src/appsscript.json`

---

## 3. ตั้งค่า Script Properties

**Project Settings (⚙️) → Script Properties → Add script property** ใส่ค่าต่อไปนี้:

| Property | ค่า | หมายเหตุ |
|---|---|---|
| `SPREADSHEET_ID` | `<SHEET_ID จากขั้นตอน 1>` | จำเป็น |
| `ADMIN_EMAILS` | `your-email@gmail.com` | อีเมลคุณ (admin คนแรก) |
| `GEMINI_API_KEY` | `<api key>` | ใส่เมื่อพร้อมใช้ AI จริง |
| `GEMINI_MODEL` | `gemini-2.0-flash` | ค่า default |
| `USE_MOCK_GEMINI` | `true` | `true` = ทดสอบ flow โดยไม่ยิง API; เปลี่ยนเป็น `false` เมื่อพร้อม |
| `ALLOWED_DOMAIN` | *(เว้นว่าง)* | ช่วง dev บน Gmail เว้นว่าง; ตั้งเป็น domain บริษัทเมื่อขึ้น Workspace |
| `RETENTION_DAYS` | `1` | ลบ transcript/AI result หลังกี่วัน |
| `DEFAULT_OUTPUT_FOLDER_ID` | *(ถ้ามี)* | โฟลเดอร์ default เก็บเอกสาร |
| `DEV_OPEN` | `false` | `true` = ให้บัญชีแรกที่เข้ามาเป็น ADMIN อัตโนมัติ (กัน lockout ตอน setup — เปิดชั่วคราวแล้วปิด) |

> ⚠️ ค่าที่ต้องการ "ปิด" ให้ **เว้นว่างหรือลบ property ทิ้ง** ห้ามใส่ `-`, `none`, `null`
> (ระบบมองว่าค่าพวกนี้ = ไม่ได้ตั้ง แล้ว แต่เลี่ยงได้ก็เลี่ยง)

---

## 4. รัน setup (ครั้งเดียว)

ที่แถบฟังก์ชันด้านบนของ editor:

1. เลือกฟังก์ชัน **`initSpreadsheet`** → กด **Run**
   - ครั้งแรกจะขอสิทธิ์ (authorize) → กดอนุญาต
   - จะสร้าง sheet ทั้งหมด + seed อีเมลใน `ADMIN_EMAILS` เป็น ADMIN
2. (ทางเลือก) เลือก **`seedSampleTemplate`** → **Run** เพื่อสร้าง template ตัวอย่าง 1 อัน

---

## 5. Deploy เป็น Web App

1. **Deploy → New deployment → Type: Web app**
2. ตั้งค่า:
   - **Execute as:** `Me`
   - **Who has access:**
     - ช่วง dev บน Gmail ส่วนตัว → `Only myself`
     - ขึ้น Workspace แล้ว → `Anyone within <domain>`
3. **Deploy** → คัดลอก **Web app URL** เปิดใช้งาน

> การควบคุมสิทธิ์จริงอยู่ที่ตาราง `USERS` (whitelist) — ทุก server function ตรวจอีเมล
> ผู้ใช้ที่ไม่มีในตารางจะเห็นหน้า "ไม่มีสิทธิ์เข้าใช้งาน"

### เพิ่มผู้ใช้คนอื่น
เปิด sheet `USERS` แล้วเพิ่มแถว: `user_email | role | status | created_at | updated_at`
- `role`: `ADMIN` / `USER` / `REVIEWER`
- `status`: `ACTIVE`

---

## 6. ตั้ง retention trigger (แนะนำ)

ให้ระบบล้าง transcript/AI result ที่หมดอายุอัตโนมัติ:

1. เมนูซ้าย **Triggers (⏰) → Add Trigger**
2. Function: **`cleanupExpiredJobs`**
3. Event source: **Time-driven** → **Day timer** → เวลาที่ต้องการ (เช่น ตี 1–2)
4. **Save**

---

## 7. เปิดใช้ Gemini จริง (เมื่อพร้อม)

1. ใส่ `GEMINI_API_KEY` ใน Script Properties
2. เปลี่ยน `USE_MOCK_GEMINI` เป็น `false`
3. (ไม่ต้อง redeploy ก็ได้ — ค่าอ่านจาก properties ทันที)

---

## 8. ทดสอบตาม Acceptance Criteria

ใช้ `examples/sample-transcript.txt` ทดสอบ flow:

1. เปิด Web app URL → เห็นชื่อ/role ของคุณ
2. (ADMIN) กด **+ สร้าง Template** เพิ่ม template ใหม่ได้
3. เลือก template → กรอกข้อมูลประชุม → วาง transcript ตัวอย่าง
4. กด "แปลง Transcript" → ตรวจว่า parse speaker/timestamp ถูก
5. กำหนดช่วงเวลาแต่ละหัวข้อ (ลองใส่เวลาทับกัน → ต้องเตือน)
6. ดูตัวอย่าง transcript แบ่งตามหัวข้อ → ลองแก้/ย้าย/exclude
7. กด "สร้างสรุปทุกหัวข้อ" (mock ได้) → ตรวจ speaker/timestamp/มติ/action item
8. แก้ผล → ยืนยันทุกหัวข้อ → กด "สร้างเอกสาร"
9. เปิดเอกสาร → ตรวจว่าไม่ถูกแชร์สาธารณะ
10. เปิด sheet `AUDIT_LOG` → เห็นบันทึกผู้สร้างและเวลา

---

## แก้ปัญหาที่พบบ่อย (Troubleshooting)

**เข้าเว็บแล้วขึ้น "ไม่มีสิทธิ์เข้าใช้งาน"**
- หน้า gate จะโชว์อีเมลที่ระบบตรวจเจอ — ถ้าโชว์อีเมลแต่ไม่ผ่าน = อีเมลไม่อยู่ใน `USERS` (เพิ่มแถว หรือใส่ใน `ADMIN_EMAILS` แล้วรัน `initSpreadsheet`)
- ถ้าโชว์ว่า "อ่านอีเมลไม่ได้" = ไป Deploy → Manage deployments → ตั้ง **Execute as: Me**
- ทางลัดตอน setup: ตั้ง `DEV_OPEN=true` ชั่วคราว → เข้าได้เลย แล้วค่อยปิด
- อย่าลืม: `ALLOWED_DOMAIN` ต้อง **เว้นว่าง** ช่วง dev (ห้ามใส่ `-`)

**หน้า 3/4 crash `Cannot read properties of null (reading 'transcript')` หรือ "จำนวนรายการ: 0"**
- เกิดจากตารางเป็น schema เก่า (คอลัมน์ไม่ตรงกับโค้ด) — เวอร์ชันนี้ **แก้ให้ auto-migrate แล้ว**
  แค่ push โค้ดใหม่ + รัน `initSpreadsheet` อีกครั้ง (จะเติมคอลัมน์ที่ขาดให้เอง)
- แล้ว **เริ่มงานใหม่จากหน้าเลือก Template** (งานเก่าที่ข้อมูลเพี้ยนใช้ต่อไม่ได้)
- อย่า refresh กลางคัน — ถ้าหลุด ระบบจะพากลับหน้าแรกแทนการ crash

**อัปโหลด .txt แล้วเป็นภาษาต่างดาว**
- เวอร์ชันนี้ตรวจ encoding อัตโนมัติ (UTF-8 / UTF-16 / Thai ANSI) แล้ว
- ถ้ายังเพี้ยน ให้ save ไฟล์เป็น UTF-8 หรือใช้วิธี paste ข้อความแทน

## ทดสอบ logic ล้วน (นอก Apps Script)

Parser / validation / split เป็น pure function ทดสอบด้วย Node ได้:

```bash
npm test          # หรือ node test/run-tests.js
```
