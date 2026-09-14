import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServiceCatalogPreview, type ServiceCatalogPreviewData } from './ServiceCatalogPreview';

const previewData: ServiceCatalogPreviewData = {
  serviceCode: 'SVC-ACCOUNT',
  serviceName: 'ขอ Account ใหม่',
  category: 'Access',
  description: 'บริการสำหรับขอสิทธิ์เข้าใช้งานระบบ',
  owner: 'เจ้าของบริการ',
  audience: 'พนักงานทุกคน',
  eligibilityRoles: ['employee'],
  eligibilityDepartments: ['ฝ่ายเทคโนโลยี'],
  slaHours: 8,
  fulfillmentGroup: 'IT Support',
  approvalWorkflow: 'กลุ่มอนุมัติ',
  formVersion: 2,
  cost: 1200,
  documentationUrl: 'https://example.com/docs/account',
  knowledge: [{ title: 'วิธีขอ Account', url: 'https://example.com/kb/account' }],
  dependencies: [{ type: 'requester_employee', label: 'ต้องมีพนักงานในระบบ' }],
  effectiveDate: '2026-09-13',
  reviewDate: '2026-12-13',
  status: 'draft',
  formSchema: [{ key: 'reason', label: 'เหตุผล', type: 'textarea', required: true }],
  checklist: [{ name: 'ตรวจสอบข้อมูล' }],
};

afterEach(cleanup);

describe('Service Catalog preview', () => {
  it('shows the service metadata and lifecycle before publish', () => {
    render(<ServiceCatalogPreview data={previewData} onClose={vi.fn()} onPublish={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Preview ก่อน Publish' })).toBeVisible();
    expect(screen.getByText('Service Owner')).toBeVisible();
    expect(screen.getByText('Audience')).toBeVisible();
    expect(screen.getByText('Form Version')).toBeVisible();
    expect(screen.getByText('v2')).toBeVisible();
    expect(screen.getByText('Effective Date')).toBeVisible();
    expect(screen.getByText('Review Date')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Publish Service' })).toBeVisible();
  });

  it('hides Publish for an already published service', () => {
    render(<ServiceCatalogPreview data={{ ...previewData, status: 'active' }} onClose={vi.fn()} onPublish={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Publish Service' })).not.toBeInTheDocument();
    expect(screen.getByText('Published / ใช้งาน')).toBeVisible();
  });
});
