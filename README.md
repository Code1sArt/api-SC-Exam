# SC Exam AI Assessment API

Backend สำหรับแพลตฟอร์มวัดผลการเรียนรู้ด้วย AI สร้างด้วย NestJS, Prisma, MySQL และ Swagger

## ความสามารถที่มีใน API ชุดแรก

- JWT authentication และ role `ADMIN`, `TEACHER`, `STUDENT`
- แยกขอบเขตข้อมูลตามองค์กร/โรงเรียน
- จัดการวิชา ตัวชี้วัด ห้องเรียน ครู และนักเรียน
- นำเข้านักเรียนจาก `.xlsx` ได้สูงสุด 5,000 คนต่อครั้ง
- ธนาคารข้อสอบ: ปรนัย ถูก/ผิด ตอบสั้น อัตนัย และเติมคำ
- สร้างข้อสอบและโจทย์ซ่อมเสริมด้วย GPT Luna-compatible API
- ตรวจและให้เหตุผลด้วย Gemini Flash
- สรุปรายงานรายบุคคลด้วย Gemini Flash-Lite
- Online exam และ adaptive difficulty (ถูกติดกัน 3 ข้อเพิ่มระดับ, ผิดติดกัน 2 ข้อลดระดับ)
- Student mastery รายตัวชี้วัด และ dashboard แบ่งกลุ่มเก่ง/กลาง/ต้องเสริม
- เก็บ AI audit log สำหรับตรวจสอบย้อนหลัง

ชื่อโมเดล AI ทั้งหมดกำหนดผ่าน environment variables จึงเปลี่ยนรุ่นได้โดยไม่แก้ business logic

## เริ่มต้นใช้งาน

```bash
cp .env.example .env
npm install
npm run db:deploy
npm run db:seed
npm run start:dev
```

ระบบใช้ MySQL ที่ติดตั้งในเครื่องหรือบนเซิร์ฟเวอร์โดยตรง ตั้งค่า host, user, password และชื่อฐานข้อมูลผ่าน `DATABASE_URL` ใน `.env` หากรหัสผ่านมีอักขระพิเศษต้อง URL-encode ก่อน

- API: `http://localhost:3000/api/v1`
- Swagger UI: `http://localhost:3000/docs`
- Health check: `GET http://localhost:3000/api/v1`

บัญชี demo จาก seed ใช้รหัสผ่าน `Demo1234!`

- `admin@demo.local`
- `teacher@demo.local`
- `student@demo.local`

หากไม่ใช้ seed ให้เรียก `POST /api/v1/auth/bootstrap` เพียงครั้งแรกเพื่อสร้างโรงเรียนและ admin

## รูปแบบไฟล์ Excel นักเรียน

แถวแรกต้องใช้ชื่อคอลัมน์ภาษาอังกฤษดังนี้:

| student_code | first_name | last_name | email | password | grade_level |
|---|---|---|---|---|---|
| STU001 | สมชาย | ใจดี | student@example.com | Student123! | ม.1 |

คอลัมน์ `password` และ `grade_level` เว้นว่างได้ ระบบจะสร้าง temporary password ให้เมื่อไม่ได้ระบุ และส่งกลับเฉพาะ response ของการ import ครั้งนั้น

Endpoint: `POST /api/v1/academic/classrooms/:classroomId/students/import` โดยส่ง `multipart/form-data` field ชื่อ `file`

## AI configuration

สำหรับ development ค่า `AI_MOCK_MODE=true` ทำให้ทดสอบ flow ได้โดยไม่เสีย API quota ก่อนใช้งานจริงให้ตั้งเป็น `false` และใส่ credentials ใน `.env`

GPT Luna adapter ใช้รูปแบบ OpenAI-compatible `POST {AI_GENERATION_BASE_URL}/chat/completions` หากผู้ให้บริการใช้ request/response คนละรูปแบบ ให้แก้เฉพาะ `src/ai/ai.service.ts`

## คำสั่งสำคัญ

```bash
npm run build
npm test -- --runInBand
npm run lint -- --no-fix
npm run verify
npm run db:studio
npm run db:deploy
```

ใน production ใช้ `npm run db:deploy` และตั้ง `JWT_SECRET`, database password, CORS และ AI keys ผ่าน secret manager

## API modules

- `/auth` — bootstrap, login, current user
- `/academic` — subjects, indicators, classrooms, teachers, students, Excel import
- `/questions` — manual/AI question bank and remedial generation
- `/exams` — create, publish, start, adaptive next question, answer, submit
- `/analytics` — teacher dashboard, exam results, indicator mastery
