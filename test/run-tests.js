/**
 * Node test harness สำหรับ pure logic ของ Auto Minute
 * โหลดไฟล์ .gs เข้า vm context เดียวกัน (ฟังก์ชันอ้างถึงกันได้)
 * รัน: node test/run-tests.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'src');
// เรียงตาม dependency: Utils ก่อน แล้วบริการที่ใช้ Utils
const files = ['Utils.gs', 'TranscriptService.gs', 'ValidationService.gs', 'AgendaService.gs'];

const ctx = { Math: Math, Date: Date, JSON: JSON, isNaN: isNaN, parseInt: parseInt, Number: Number, String: String };
vm.createContext(ctx);
for (const f of files) {
  const code = fs.readFileSync(path.join(srcDir, f), 'utf8');
  vm.runInContext(code, ctx, { filename: f });
}

// ---- mini test framework ----
let pass = 0, fail = 0;
const fails = [];
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else { fail++; fails.push(`✗ ${msg}\n    expected: ${e}\n    actual:   ${a}`); }
}
function ok(cond, msg) {
  if (cond) pass++; else { fail++; fails.push(`✗ ${msg}`); }
}
function section(name) { console.log('\n— ' + name + ' —'); }

// =====================================================================
section('timestampToSeconds_');
eq(ctx.timestampToSeconds_('00:01:10'), 70, 'HH:MM:SS -> seconds');
eq(ctx.timestampToSeconds_('01:00:00'), 3600, '1 hour');
eq(ctx.timestampToSeconds_('00:42:20'), 2540, '42:20');
eq(ctx.timestampToSeconds_('05:30'), 330, 'MM:SS fallback');
eq(ctx.timestampToSeconds_('bad'), null, 'invalid -> null');
eq(ctx.secondsToTimestamp_(2540), '00:42:20', 'seconds -> HH:MM:SS');
ok(ctx.isValidHms_('00:08:35'), 'isValidHms true');
ok(!ctx.isValidHms_('8:35'), 'isValidHms false for MM:SS');

// =====================================================================
section('parseTranscript — bracket format, multiline, numeric speaker, Thai-Eng');
const tx1 = [
  '[00:01:10] 1:',
  'สวัสดีครับ วันนี้เราจะเริ่ม meeting กันนะครับ',
  '',
  '[00:02:15] 2:',
  'Agenda 1 คือการรับรองรายงานการประชุมครั้งก่อน',
  'ไม่มีการแก้ไขเพิ่มเติมครับ',
  '',
  '[00:09:05] 3: Q3 identified 93 risks รวม Low 82 และ Medium 11 รายการ'
].join('\n');
const p1 = ctx.parseTranscript(tx1);
eq(p1.count, 3, 'parsed 3 entries');
eq(p1.rows[0].speaker, '1', 'numeric speaker 1');
eq(p1.rows[0].timestamp, '00:01:10', 'timestamp preserved');
eq(p1.rows[0].timestampSeconds, 70, 'timestampSeconds computed');
ok(p1.rows[0].text.indexOf('meeting') >= 0, 'thai-eng text captured');
eq(p1.rows[1].text.split('\n').length, 2, 'multiline text merged (2 lines)');
eq(p1.rows[2].speaker, '3', 'inline speaker on same line');
ok(p1.rows[2].text.indexOf('93 risks') >= 0, 'inline text captured');
eq(p1.maxTimestamp, '00:09:05', 'maxTimestamp');

section('parseTranscript — plain format (no brackets)');
const tx2 = [
  '00:00:05 1: เปิดประชุม',
  '00:03:00 2: รายงานผลประกอบการ'
].join('\n');
const p2 = ctx.parseTranscript(tx2);
eq(p2.count, 2, 'plain format 2 entries');
eq(p2.rows[0].speaker, '1', 'plain speaker');
eq(p2.rows[1].timestampSeconds, 180, 'plain ts seconds');

section('parseTranscript — warnings');
const p3 = ctx.parseTranscript('ข้อความก่อน timestamp\n[00:00:10] 1: ok');
ok(p3.warnings.some(w => w.indexOf('ก่อน timestamp') >= 0), 'warns pre-header text');
ok(p3.count === 1, 'still parses valid entry');

// =====================================================================
section('validateTopicRanges');
const topicsValid = [
  { key: '1.1', topic_no: '1.1', topic_title: 'A', start_time: '00:00:00', end_time: '00:08:35' },
  { key: '2.1', topic_no: '2.1', topic_title: 'B', start_time: '00:08:35', end_time: '00:42:20' }
];
let v = ctx.validateTopicRanges(topicsValid, 2540);
ok(v.valid, 'contiguous ranges valid');
eq(v.errors.length, 0, 'no errors');

const topicsOverlap = [
  { key: '1.1', topic_no: '1.1', start_time: '00:00:00', end_time: '00:10:00' },
  { key: '2.1', topic_no: '2.1', start_time: '00:05:00', end_time: '00:20:00' }
];
v = ctx.validateTopicRanges(topicsOverlap, 3000);
ok(!v.valid, 'overlap invalid');
ok(v.errors.some(e => e.indexOf('ทับกัน') >= 0), 'overlap error message');

const topicsBad = [{ key: '1.1', topic_no: '1.1', start_time: '00:10:00', end_time: '00:05:00' }];
v = ctx.validateTopicRanges(topicsBad, 3000);
ok(v.errors.some(e => e.indexOf('น้อยกว่า') >= 0), 'start<end error');

const topicsExceed = [{ key: '1.1', topic_no: '1.1', start_time: '00:00:00', end_time: '01:00:00' }];
v = ctx.validateTopicRanges(topicsExceed, 100);
ok(v.errors.some(e => e.indexOf('เกินความยาว') >= 0), 'exceed max error');

const topicsFormat = [{ key: '1.1', topic_no: '1.1', start_time: '0:0:0', end_time: 'xx' }];
v = ctx.validateTopicRanges(topicsFormat, 0);
ok(v.errors.some(e => e.indexOf('รูปแบบ HH:MM:SS') >= 0), 'format error');

const topicsGap = [
  { key: '1.1', topic_no: '1.1', start_time: '00:00:00', end_time: '00:05:00' },
  { key: '2.1', topic_no: '2.1', start_time: '00:10:00', end_time: '00:15:00' }
];
v = ctx.validateTopicRanges(topicsGap, 1000);
ok(v.valid, 'gap is valid (not error)');
ok(v.warnings.some(w => w.indexOf('ช่องว่าง') >= 0), 'gap warning');

// =====================================================================
section('splitTranscriptByTopic — boundaries (end exclusive)');
const rows = [
  { id: 0, timestamp: '00:00:05', timestampSeconds: 5, speaker: '1', text: 'a' },
  { id: 1, timestamp: '00:05:00', timestampSeconds: 300, speaker: '2', text: 'b' },   // boundary
  { id: 2, timestamp: '00:09:00', timestampSeconds: 540, speaker: '3', text: 'c' },
  { id: 3, timestamp: '00:50:00', timestampSeconds: 3000, speaker: '4', text: 'd' }    // unassigned
];
const norm = [
  { topic_no: '1.1', start_seconds: 0, end_seconds: 300 },
  { topic_no: '2.1', start_seconds: 300, end_seconds: 600 }
];
const split = ctx.splitTranscriptByTopic(rows, norm);
eq(split[0].topicKey, '1.1', 'row at 5s -> 1.1');
eq(split[1].topicKey, '2.1', 'row at 300s -> 2.1 (end exclusive on prev)');
eq(split[2].topicKey, '2.1', 'row at 540s -> 2.1');
eq(split[3].topicKey, null, 'row at 3000s -> unassigned');
ok(split[0].excluded === false, 'default not excluded');

section('splitTranscriptByTopic — fallback when timestampSeconds is bad');
const rowsBadSecs = [
  { id: 0, timestamp: '00:00:05', timestampSeconds: null, speaker: '1', text: 'a' },   // null -> derive
  { id: 1, timestamp: '00:00:10', timestampSeconds: '00:00:10', speaker: '2', text: 'b' }, // string -> derive
  { id: 2, timestamp: '00:09:00', timestampSeconds: undefined, speaker: '3', text: 'c' }  // undefined -> derive
];
const normFb = [{ topic_no: '1.1', start_seconds: 0, end_seconds: 300 }, { topic_no: '2.1', start_seconds: 300, end_seconds: 600 }];
const splitFb = ctx.splitTranscriptByTopic(rowsBadSecs, normFb);
eq(splitFb[0].topicKey, '1.1', 'null timestampSeconds -> derived from "00:00:05" -> 1.1');
eq(splitFb[1].topicKey, '1.1', 'string timestampSeconds -> derived from "00:00:10" -> 1.1');
eq(splitFb[2].topicKey, '2.1', 'undefined timestampSeconds -> derived from "00:09:00" -> 2.1');
eq(splitFb[0].timestampSeconds, 5, 'derived seconds stored back');

section('findUnassignedRows');
const unassigned = ctx.findUnassignedRows(rows, norm);
eq(unassigned.length, 1, '1 unassigned row');
eq(unassigned[0].id, 3, 'row id 3 unassigned');

section('flattenAgendas_');
const flat = ctx.flattenAgendas_([
  { agenda_no: '1', agenda_title: 'วาระ 1', summary_instruction: 'x',
    topics: [{ topic_no: '1.1', topic_title: 't1', start_time: '00:00:00', end_time: '00:05:00', note: 'n' }] },
  { agenda_no: '2', agenda_title: 'วาระ 2',
    topics: [
      { topic_no: '2.1', topic_title: 't2', start_time: '00:05:00', end_time: '00:10:00' },
      { topic_no: '2.2', topic_title: 't3', start_time: '00:10:00', end_time: '00:15:00' }
    ] }
]);
eq(flat.length, 3, 'flattened 3 topics');
eq(flat[0].agenda_title, 'วาระ 1', 'agenda_title carried to topic');
eq(flat[2].topic_no, '2.2', 'sub-topic 2.2 present');

// =====================================================================
console.log('\n============================');
if (fail) {
  console.log(fails.join('\n\n'));
  console.log(`\n❌ FAILED: ${fail} · passed: ${pass}`);
  process.exit(1);
} else {
  console.log(`✅ ALL PASSED: ${pass} assertions`);
  process.exit(0);
}
