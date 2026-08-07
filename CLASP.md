# Auto-deploy ขึ้น Apps Script ด้วย clasp + GitHub Actions

ตั้งครั้งเดียว หลังจากนี้ **push เข้า `main` → โค้ดใน `src/` ขึ้น Apps Script อัตโนมัติทั้งหมด**
(ไม่ต้อง copy ไฟล์ทีละอันอีก และไม่มีทางตกไฟล์)

> ทุกขั้นตอนทำผ่านเบราว์เซอร์ — ไม่ต้องลงอะไรบน notebook บริษัท

---

## ขั้นที่ 1 — เอา Script ID
1. เปิด Apps Script project ของคุณ (script.google.com → โปรเจกต์ Auto Minute)
2. ⚙️ **Project Settings** → คัดลอก **Script ID**
3. เปิด **Apps Script API**: https://script.google.com/home/usersettings → เปิด

## ขั้นที่ 2 — ใส่ Script ID ลง `.clasp.json`
แก้ไฟล์ `.clasp.json` (ที่ root ของ repo) แทนที่ `PASTE_YOUR_SCRIPT_ID_HERE` ด้วย Script ID จริง:
```json
{ "scriptId": "1AbC...xyz", "rootDir": "src" }
```
commit + push ได้ (ไฟล์นี้มีแค่ scriptId ไม่ใช่ความลับ)

## ขั้นที่ 3 — เอา credential ผ่าน GitHub Codespaces (เบราว์เซอร์)
1. หน้า repo บน GitHub → ปุ่ม **Code** → แท็บ **Codespaces** → **Create codespace on main**
2. ใน terminal ของ Codespaces:
   ```bash
   npm install -g @google/clasp@2.4.2
   clasp login --no-localhost
   ```
   เปิดลิงก์ที่ขึ้นมา → อนุญาต → คัดลอก code กลับมาวาง
3. แสดง credential แล้วคัดลอก **ทั้งหมด**:
   ```bash
   cat ~/.clasprc.json
   ```
4. ปิด/ลบ codespace ได้เลย (ใช้ครั้งเดียว)

## ขั้นที่ 4 — ใส่ credential เป็น GitHub Secret
1. repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**
2. Name: **`CLASPRC_JSON`**
3. Value: วางเนื้อหา `~/.clasprc.json` ทั้งหมด → **Add secret**

> ⚠️ `.clasprc.json` มี OAuth refresh token — เก็บเป็น Secret เท่านั้น **ห้าม commit ลง repo**

## ขั้นที่ 5 — ทดสอบ
- แก้อะไรเล็ก ๆ ใน `src/` แล้ว push เข้า `main` (หรือไปแท็บ **Actions** → เลือก workflow → **Run workflow**)
- ดูแท็บ **Actions** ว่าขึ้น ✅ เขียว
- เปิด Apps Script editor → โค้ดอัปเดตแล้ว

---

## สิ่งที่ clasp **ไม่ได้** ทำให้ (ยังต้องทำในเว็บ Apps Script เอง ครั้งเดียว)
- ตั้ง **Script Properties** (GEMINI_API_KEY, SPREADSHEET_ID, ADMIN_EMAILS ฯลฯ)
- **Deploy เป็น Web App** ครั้งแรก + เลือก "Execute as: Me"
- เพิ่ม **trigger** `cleanupExpiredJobs`
- รัน `initSpreadsheet` ครั้งแรก

> เคล็ดลับ: ใช้ **Test deployment (`/dev`)** ระหว่าง dev — มันรันโค้ดล่าสุดเสมอ ไม่ต้อง deploy version ใหม่ทุกครั้ง
> พอ clasp push เสร็จ เปิด `/dev` refresh ก็เห็นโค้ดใหม่ทันที

## หมายเหตุ
- `src/app.js.html` จะถูก push เป็นไฟล์ HTML ชื่อ `app.js` ใน Apps Script (ตรงกับ `include('app.js')`)
- `test/`, `examples/`, `tools/`, `README.md`, `SETUP.md` ฯลฯ อยู่นอก `src/` → ไม่ถูก push
