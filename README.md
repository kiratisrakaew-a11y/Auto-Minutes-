# Auto Minute

Google Apps Script Web App สำหรับสร้าง **รายงานการประชุมอัตโนมัติ** จาก Transcript
ที่มี speaker + timestamp อยู่แล้ว (ไม่ทำ speech-to-text / ไม่ยุ่งไฟล์เสียง-วิดีโอ)

Flow: เลือก Template → กรอกข้อมูลประชุม + นำเข้า Transcript → กำหนดวาระ/หัวข้อ + ช่วงเวลา →
ตรวจ/แก้ Transcript ตามหัวข้อ → ให้ Gemini สรุป **ทีละหัวข้อ** → human review → สร้าง Google Docs

> การหั่นและการสรุปทำในหน่วย **"หัวข้อ" (topic)** — 1 วาระมีได้หลายหัวข้อย่อย (เช่น 3.1, 3.2)

## จุดเด่นเชิงออกแบบ
- **แยก layer ชัดเจน** — Service / Validation / UI แยกกัน (สลับ DB หรือ AI provider ได้)
- **ประมวลผลทีละหัวข้อผ่าน client queue** — เลี่ยง Apps Script timeout, resume จากหัวข้อที่ fail ได้
- **AI ตอบ JSON ตาม schema** + เก็บ evidence timestamp + สถานะ `explicit`/`inferred`/`unknown` (กัน AI เดา)
- **บังคับ human review** ก่อนสร้างเอกสารเสมอ
- **Security** — whitelist ผู้ใช้ใน sheet USERS, API key อยู่ใน Script Properties, เอกสารไม่แชร์สาธารณะ, audit log

## โครงสร้างไฟล์ (`src/`)
| ไฟล์ | หน้าที่ |
|---|---|
| `Config.gs` | config keys, constants, header ของ sheet |
| `Utils.gs` | time/JSON/id helpers (pure) |
| `SheetService.gs` | repository layer (จุดสลับ DB) |
| `AuthService.gs` | ตัวตน (Google OAuth) + สิทธิ์ (whitelist/role) |
| `AuditService.gs` | audit log |
| `TemplateService.gs` | จัดการ template + วาระเริ่มต้น (admin) |
| `TranscriptService.gs` | parser Transcript → JSON (pure) |
| `MeetingJobService.gs` | meeting job CRUD + retention |
| `AgendaService.gs` | topic CRUD + หั่น transcript ตามหัวข้อ (pure split) |
| `ValidationService.gs` | ตรวจช่วงเวลา (pure) |
| `GeminiService.gs` | Gemini API (mock+real) + AI processing endpoints |
| `GoogleDocsService.gs` | สร้าง Google Docs จาก template |
| `Code.gs` | doGet + setup functions |
| `index/styles/*.html`, `app.js.html` | หน้าเว็บ (SPA) |

## ติดตั้ง
ดู **[SETUP.md](SETUP.md)** — วิธี copy-paste เข้า Apps Script, ตั้งค่า, deploy, ตั้ง trigger

## ทดสอบ logic ล้วน
```bash
npm test
```
รัน parser / validation / split ผ่าน Node (ไม่ต้องมี Apps Script)

## สถานะ
MVP ครบ Phase 1–6 — เริ่มด้วย `USE_MOCK_GEMINI=true` เพื่อเดิน flow ได้ทันที
แล้วสลับเป็น Gemini จริงเมื่อพร้อม (ใส่ API key + ตั้ง `false`)
