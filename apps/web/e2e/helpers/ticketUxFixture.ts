import type { Page } from '@playwright/test';

export const category = { id: '11111111-1111-4111-8111-111111111111', name: 'คอมพิวเตอร์และอุปกรณ์', default_priority: 'ปานกลาง', status: 'active' };
export const ticket = {
  id: 'ticket-1', ticket_no: 'TCK-20261019-0001', title: 'เครื่องพิมพ์ฝ่ายการเงินเชื่อมต่อไม่ได้และมีข้อความแจ้งเตือน',
  requester_id: 'requester-1', requester_name_snapshot: 'สมชาย ใจดี', department_name_snapshot: 'ฝ่ายการเงินและบัญชี', requester_position_snapshot: 'นักบัญชี',
  guest_name: null, guest_department: null, source_channel: 'web', category_id: category.id, priority: 'สูง', status: 'กำลังดำเนินการ', assignee_id: 'staff-1',
  assignee_name_snapshot: 'เจ้าหน้าที่ไอทีผู้รับผิดชอบ', is_security: false, incident_id: null, due_at: null, created_at: '2026-10-19T02:00:00Z',
  outsource_name: null, ticket_categories: category, requester: null, assignee: null, requester_phone: '0812345678', location: 'อาคารสำนักงาน ชั้น 3 ฝ่ายการเงิน',
  incident_at: '2026-10-19T02:00:00Z', erp_module: null, description: 'สั่งพิมพ์แล้วเครื่องไม่ตอบสนอง ลองเชื่อมต่อใหม่แล้วยังใช้งานไม่ได้ กรุณาติดต่อก่อนเข้าตรวจสอบ',
  attachments: [], worklogs: [], reopen_count: 0, response_sla_hours: 4, resolution_sla_hours: 24,
};

export async function installTicketUxFixture(page: Page) {
  const expiry = Math.floor(Date.now() / 1000) + 86400;
  const jwt = `${Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')}.${Buffer.from(JSON.stringify({sub:'staff-1',exp:expiry,aal:'aal1'})).toString('base64url')}.test-signature`;
  const replayInPage = page.context().browser()?.browserType().name() === 'webkit';
  if (replayInPage) await page.exposeFunction('__lifeTicketFixture', (url: string, method: string) => fixtureResponse(new URL(url), method));
  await page.addInitScript(({jwt, expiry, replayInPage}) => {
    const session = JSON.stringify({ access_token:jwt, refresh_token:'test-refresh', token_type:'bearer', expires_at:expiry, expires_in:86400, user:{id:'staff-1',email:'ui-test@example.com',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{}} });
    // Supply an isolated session regardless of the build's Supabase project key.
    // All API/auth traffic is intercepted below; these tests never use live data.
    // WebKit's Storage named properties do not reliably shadow getItem on an
    // instance. Patch the prototype only inside this isolated test context.
    const originalGetItem = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key: string) {
      return this === sessionStorage && key.startsWith('sb-') && key.endsWith('-auth-token')
        ? session
        : originalGetItem.call(this, key);
    };
    // Replay API fixtures on the preview origin. The UI tests intentionally
    // have no API server; WebKit otherwise attempts a real cross-origin
    // preflight before the mocked request can be fulfilled.
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (typeof input === 'string' && input.includes('/api/v1/')) {
        const target = new URL(input, window.location.href);
        if (replayInPage) {
          const bridge = window as typeof window & { __lifeTicketFixture: (url: string, method: string) => Promise<unknown> };
          return bridge.__lifeTicketFixture(target.href, init?.method ?? 'GET').then(data => new Response(JSON.stringify({ success: true, data }), { headers: { 'content-type': 'application/json' } }));
        }
        return originalFetch(target.pathname + target.search, init);
      }
      return originalFetch(input, init);
    };
    localStorage.setItem('itlife-theme', 'light');
  }, {jwt, expiry, replayInPage});
  function fixtureResponse(u: URL, method: string) {
    const path = u.pathname;
    let data: unknown = [];
    if (path.endsWith('/auth/mfa-policy')) data = {required:false,currentLevel:'aal1',enrolled:false,needsEnrollment:false};
    else if (path.endsWith('/auth/me')) data = {profile:{id:'staff-1',full_name:'เจ้าหน้าที่ IT',email:'ui-test@example.com',phone:'0812345678',status:'active',department_id:'dep-1',position_id:'pos-1'},roles:[{role_key:'it_admin',role_name_th:'ผู้ดูแลระบบ'}], permissions:['ticket.view','ticket.create','ticket.update','ticket.assign','ticket.close','ticket.comment','ticket.view_all','asset.view']};
    else if (path.endsWith('/ticket-categories')) data = [category];
    else if (path.endsWith('/departments')) data = [{id:'dep-1',name_th:'เทคโนโลยีสารสนเทศ'}];
    else if (path.endsWith('/positions')) data = [{id:'pos-1',name_th:'เจ้าหน้าที่'}];
    else if (path.endsWith('/tickets/assignable-staff')) data = [{id:'staff-1',full_name:'เจ้าหน้าที่ IT',email:'ui-test@example.com'}];
    else if (path.endsWith('/tickets/queue-summary')) data = {unassigned:3,nearSla:1,overdue:2,waitingFollowUp:0,awaitingAcceptance:1,paused:0};
    else if (path.endsWith('/tickets/ticket-1')) data = ticket;
    else if (path.endsWith('/tickets')) data = method === 'POST' ? {id:'ticket-new',ticket_no:'TCK-NEW'} : {items:[ticket,{...ticket,id:'ticket-2',ticket_no:'TCK-20261019-0002',title:'เข้าใช้งานระบบ ERP ไม่ได้',status:'ใหม่',priority:'ปานกลาง'}],pagination:{page:Number(u.searchParams.get('page')||1),pageSize:20,totalItems:u.searchParams.has('status')?2:12,totalPages:3}};
    else if (path.endsWith('/notifications')) data = {items:[],unreadCount:0,pagination:{page:1,pageSize:20,totalItems:0,totalPages:1}};
    return data;
  }

  await page.route('**/api/v1/**', async route => {
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
    };
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    const data = fixtureResponse(new URL(route.request().url()), route.request().method());
    await route.fulfill({headers: cors, json:{success:true,data}});
  });
  await page.route('**/auth/v1/**', route => route.fulfill({json:{}}));
}
