import { ServiceRequestsPage } from '../serviceRequests/ServiceRequestsPage';

/** เส้นทางเดิมของผู้ดูแลยังคงใช้ได้ แต่เปิด workspace ที่แท็บจัดการ Catalog โดยตรง */
export function ServiceCatalogPage() {
  return <ServiceRequestsPage initialTab="manage" />;
}
