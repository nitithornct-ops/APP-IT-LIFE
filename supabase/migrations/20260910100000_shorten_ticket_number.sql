-- ---------------------------------------------------------------------------
-- ย่อเลขที่ Ticket จาก 16 หลักฐานสิบหกเหลือ 8 ให้ตรงกับทุกโมดูลในระบบ
--
-- รูปแบบเดิม TCK-YYYYMMDD-<16 hex> ถูกคงไว้เพื่อให้ตรงกับเลขที่ระบบเดิมออกให้ ตอนที่ยังวางแผนจะ
-- ยกข้อมูลเก่าเข้ามา แต่การขึ้นระบบจริงเลือกโหมด fresh-start (2026-08-18) จึงไม่มีเลขเก่าให้ต้อง
-- ตรงกันอีกต่อไป เหตุผลเดียวที่ทำให้ยอมรับเลข 29 ตัวอักษรจึงหมดไป
--
-- ทำไมต้องสั้นลง: เลขนี้คือสิ่งที่ผู้ใช้อ่านให้เจ้าหน้าที่ฟังทางโทรศัพท์ และจดลงกระดาษ ตัวอักษร
-- ฐานสิบหก 16 ตัวอย่าง 3884B6E67F454FDF สับสนระหว่าง B กับ 8 และ F กับ E ได้ง่ายมาก โมดูลอื่น
-- (INC-, CHG-, PRB-) ใช้ 8 ตัวมาตลอดและไม่เคยมีปัญหา
--
-- ความเสี่ยงเลขซ้ำ: 8 หลักฐานสิบหก = 4,294,967,296 ค่าต่อวัน ที่ปริมาณงานระดับหลักร้อยใบต่อวัน
-- โอกาสชนต่ำมากอยู่แล้ว แต่ของเดิมไม่มีการลองใหม่เลย ชนเมื่อไหร่คือแจ้ง Ticket ไม่สำเร็จทันที
-- ฉบับนี้จึงวนหาเลขที่ยังไม่ถูกใช้สูงสุด 10 ครั้งก่อนยอมแพ้ ทำให้ทนทานกว่าเดิมทั้งที่เลขสั้นลง
-- (unique constraint tickets_ticket_no_unique ยังเป็นด่านสุดท้ายเสมอ)
--
-- เลขที่ออกไปแล้วไม่ถูกแตะต้อง — ฟังก์ชันนี้ใช้ตอนสร้างแถวใหม่เท่านั้น
-- ---------------------------------------------------------------------------
create or replace function public.allocate_ticket_number(reference_at timestamptz)
returns text
language plpgsql
security definer
volatile
set search_path = public
as $$
declare
  v_prefix text := to_char(coalesce(reference_at, now()) at time zone 'Asia/Bangkok', 'YYYYMMDD');
  v_candidate text;
begin
  for _ in 1..10 loop
    v_candidate := format('TCK-%s-%s', v_prefix, upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)));
    if not exists (select 1 from public.tickets where ticket_no = v_candidate) then
      return v_candidate;
    end if;
  end loop;

  raise exception 'ออกเลขที่ Ticket ไม่สำเร็จหลังลอง 10 ครั้ง กรุณาลองใหม่อีกครั้ง';
end;
$$;

revoke all on function public.allocate_ticket_number(timestamptz) from public, anon, authenticated;
