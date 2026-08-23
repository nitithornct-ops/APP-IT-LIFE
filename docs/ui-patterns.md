# APP-IT-LIFE UI patterns

เอกสารนี้เป็นสัญญาร่วมของ presentation layer สำหรับหน้าใน `apps/web` โดยใช้ component และ class สีเดิมของระบบเท่านั้น ห้ามสร้าง status mapping ซ้ำในหน้า และห้ามแก้ theme token เพื่อทำตามตัวอย่างนี้

## โครงหน้ามาตรฐาน

เรียงส่วนประกอบตามลำดับนี้: `PageHeader` → `KpiStrip` (เมื่อมีตัวเลขช่วยตัดสินใจ) → `FilterBar` → เนื้อหา โดย `FilterBar` ต้องต่อกับขอบบนของตาราง

```tsx
<div className="flex flex-col gap-4">
  <PageHeader
    eyebrow="Service Desk / Ticket"
    title="รายการ Ticket"
    description="ติดตามสถานะ ผู้รับผิดชอบ และ SLA จากหน้าจอเดียว"
    secondaryActions={<Button variant="outline">รายงาน</Button>}
    primaryAction={<Button>เปิด Ticket</Button>}
  />
  <KpiStrip items={kpiItems} />
  <section>
    <FilterBar {...filterProps} />
    <DataTable tableId="tickets">...</DataTable>
  </section>
</div>
```

หนึ่งหน้ามี primary action ใน `PageHeader` ได้หนึ่งรายการ ปุ่มอื่นใช้ `secondaryActions` และ variant รอง ห้ามวางปุ่มหลักอีกชุดไว้เหนือเนื้อหา

## Shared primitives

### PageHeader

ใช้กับหน้าภายในระบบทุกหน้า รับบริบทใน `eyebrow`, ชื่อหน้าใน `title`, และคำอธิบายหนึ่งบรรทัดใน `description` ส่วนสถานะหรือ metadata สั้น ๆ ใส่ใน `meta` ได้

### KpiStrip

ใช้เมื่อค่าช่วยให้ผู้ใช้เลือกงานถัดไปได้ แต่ละเซลล์ควรมี `href` หรือ `onClick` เพื่อเปิดรายการที่กรองแล้ว และใช้ `active` บอกว่าตัวกรองใดทำงานอยู่ จอแคบกว่า 420px จะเรียงหนึ่งเซลล์ต่อแถวโดยอัตโนมัติ

```tsx
<KpiStrip items={[
  { key: 'new', label: 'ใหม่', value: counts.new, onClick: () => setStatus('new'), active: status === 'new' },
  { key: 'mine', label: 'ของฉัน', value: counts.mine, href: '/tickets?mine=true' },
]} />
```

### FilterBar

เป็น controlled component เพื่อให้ใช้ query state เดิมได้ทั้ง client และ server มี search เดียว, select เฉพาะ field สำคัญ, quick filter, จำนวนผล และล้างตัวกรองครั้งเดียว ใช้ `filterControlClass` กับ select ที่ส่งผ่าน `filters` เพื่อให้ขนาดตรงกัน

```tsx
<FilterBar
  searchValue={search}
  onSearchChange={setSearch}
  filters={<select className={filterControlClass} aria-label="สถานะ">...</select>}
  quickFilters={quickFilters}
  activeFilterCount={activeFilterCount}
  onClear={clearFilters}
  resultCount={totalItems}
  itemLabel="Ticket"
/>
```

### StatusBadge และ SlaBadge

`StatusBadge` รับ `label` และ `tone` จาก `*Display.ts` ของโมดูลเท่านั้น เพื่อรักษาความหมายเดิมและให้ทุกสีมีข้อความกำกับ ส่วน `SlaBadge` รับเฉพาะค่า `overdue` หรือ `dueSoon` ที่เหลือส่งเป็น `fallback` ซึ่งจะแสดงเป็นข้อความธรรมดา

```tsx
<StatusBadge display={ticketStatusDisplay[ticket.status]} />
<SlaBadge display={slaDisplay} fallback={formatThaiDate(ticket.due_at)} />
```

ตัวคำนวณของโมดูลต้องคืน `null` ให้ `SlaBadge` เมื่อไม่เกินกำหนดและเหลือมากกว่า 4 ชั่วโมง ห้ามนำ logic SLA ไปไว้ใน primitive

### DetailLayout

ใช้กับหน้า detail ที่ต้องดูข้อมูลและลงมือทำพร้อมกัน เนื้อหาและ timeline อยู่ฝั่งซ้าย ส่วน action panel และข้อมูลประกอบอยู่ใน `aside` กว้าง 340px บนจอใหญ่และเรียงเป็นคอลัมน์เดียวบนจอเล็ก

```tsx
<DetailLayout
  timeline={<TicketTimeline ticketId={id} />}
  aside={<UpdateWorkPanel ticket={ticket} />}
>
  <TicketSummary ticket={ticket} />
</DetailLayout>
```

### LoadingState, EmptyState, ErrorState

- `LoadingState` หน่วงค่าเริ่มต้น 180ms และไม่ใช้ overlay
- `EmptyState` ต้องระบุสาเหตุใน `description` พร้อม action ที่พาผู้ใช้ไปต่อ เช่น ล้างตัวกรองหรือสร้างรายการ
- `ErrorState` หรือ `QueryError` ต้องมีวิธีลองใหม่เมื่อ query รองรับ `refetch`

จัดลำดับเงื่อนไขเป็น loading → error → empty → success เพื่อให้หน้ามีครบสี่สถานะ

### CommandPalette

`AppShell` เปิด palette ด้วย `Ctrl/Cmd + K` อยู่แล้ว เมนูมาจาก `navigation.ts` ผ่าน `useNavItems` จึงกรองตาม permission เดิม ผลข้อมูลค้น Ticket, Asset, Incident จาก global search และค้น CI ผ่าน list endpoint เดิมของ CMDB ซึ่งตรวจ `cmdb.view` ฝั่ง API

หน้าโมดูลไม่ต้อง mount palette ซ้ำ หากเพิ่มเมนูใหม่ให้เพิ่มใน `navigation.ts` เพียงที่เดียว

## DataTable contract

รายการแบบตารางต้องใช้ `DataTable` และกำหนด `tableId` ที่คงที่ เพื่อจำจำนวนแถวและคอลัมน์ที่ผู้ใช้เลือก

- ค่าเริ่มต้นมีไม่เกิน 6–7 คอลัมน์: รหัส/ชื่อ → สถานะ → ผู้รับผิดชอบ → กำหนดเวลา → action
- รวมข้อมูลสัมพันธ์กันเป็นเซลล์สองบรรทัด และซ่อนคอลัมน์รองผ่านตัวเลือกคอลัมน์
- ประกาศ `data-sort-key` ที่หัวคอลัมน์ และ `data-sort-value` ที่ cell เมื่อข้อความที่แสดงไม่ใช่ค่าที่ใช้เรียง
- client mode มี search, filter, clear, sort, export และ pagination 10/25/50 ในตัว
- server mode ให้หน้าเป็นเจ้าของ search/filter/pagination แต่ `DataTable` ยังจัดการ column visibility และ export หน้าปัจจุบัน
- ถ้าหน้ามีการส่งออกผลที่กรองครบทุกหน้าอยู่แล้ว ให้ตั้ง `currentPageExport={false}` เพื่อไม่ให้มี action ซ้ำ
- ต่ำกว่า 768px ตารางจะแสดงเป็น record card หนึ่งใบต่อแถวจาก label ของหัวคอลัมน์

รายการเร่งด่วน เช่น เกิน SLA, รออนุมัติ หรือวิกฤต ต้องกำหนด default sort ผ่าน query ของหน้า/API ไม่เรียงข้อมูล server-side ซ้ำใน `DataTable`

## Accessibility และ responsive

interactive control ต้องมีพื้นที่กดอย่างน้อย 40px, icon-only button ต้องมี `aria-label`, และใช้ focus style เดิมของระบบ ทุก action ต้องเข้าถึงได้ด้วย keyboard หน้ารายการต้องตรวจที่ 1440px, 768px และ 390px ก่อนส่งมอบ

งานลบต้องใช้ confirm flow เดิมและเรียก soft-delete contract ที่มีอยู่ ห้ามเพิ่ม hard delete ใน presentation layer

## หน้าตัวอย่างอ้างอิง

ใช้ `TicketsPage` เป็นตัวอย่าง list page และ `TicketDetailPage` เป็นตัวอย่าง detail page ทั้งสองหน้าใช้ primitive ชุดนี้โดยไม่เปลี่ยน API contract หรือ business logic
