import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

vi.mock('./components/ProtectedRoute', () => ({ ProtectedRoute: ({ children }: { children: ReactNode }) => children }));
vi.mock('./layouts/AppShell', () => ({ AppShell: () => <Outlet /> }));
vi.mock('./features/incidents/IncidentsPage', () => ({ IncidentsPage: () => <p>incident list</p> }));
vi.mock('./features/incidents/IncidentDetailPage', () => ({ IncidentDetailPage: () => <h1>incident detail</h1> }));
vi.mock('./features/problems/ProblemsPage', () => ({ ProblemsPage: () => <p>problem list</p> }));
vi.mock('./features/problems/ProblemDetailPage', () => ({ ProblemDetailPage: () => <h1>problem detail</h1> }));
vi.mock('./features/changes/ChangesPage', () => ({ ChangesPage: () => <p>change list</p> }));
vi.mock('./features/changes/ChangeDetailPage', () => ({ ChangeDetailPage: () => <h1>change detail</h1> }));
vi.mock('./features/assets/AssetsPage', () => ({ AssetsPage: () => <p>asset list</p> }));
vi.mock('./features/assets/AssetDetailPage', () => ({ AssetDetailPage: () => <h1>asset detail</h1> }));
vi.mock('./features/cmdb/CmdbPage', () => ({ CmdbPage: () => <p>CI list</p> }));
vi.mock('./features/cmdb/ConfigurationItemDetailPage', () => ({ ConfigurationItemDetailPage: () => <h1>CI detail</h1> }));
vi.mock('./features/serviceRequests/ServiceRequestsPage', () => ({ ServiceRequestsPage: () => <p>service request list</p> }));
vi.mock('./features/serviceRequests/ServiceRequestDetailPage', () => ({ ServiceRequestDetailPage: () => <h1>service request detail</h1> }));
vi.mock('./features/accessRequests/AccessRequestsPage', () => ({ AccessRequestsPage: () => <p>access request list</p> }));
vi.mock('./features/accessRequests/AccessRequestDetailPage', () => ({ AccessRequestDetailPage: () => <h1>access request detail</h1> }));

afterEach(cleanup);

describe('full page module details', () => {
  it.each([
    ['/incidents/record-1', 'incident'], ['/problems/record-1', 'problem'],
    ['/changes/record-1', 'change'], ['/assets/record-1', 'asset'], ['/cmdb/record-1', 'CI'],
    ['/service-requests/record-1', 'service request'], ['/access-requests/record-1', 'access request'],
  ])('opens %s directly without mounting a second list behind an overlay', async (path, label) => {
    render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: `${label} detail` })).toBeInTheDocument();
    expect(screen.queryByText(`${label} list`)).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
