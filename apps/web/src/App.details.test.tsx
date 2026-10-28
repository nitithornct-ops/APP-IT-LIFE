import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { DetailLink } from './components/ui/DetailLink';
import { MemoryRouter, Outlet } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

vi.mock('./components/ProtectedRoute', () => ({ ProtectedRoute: ({ children }: { children: ReactNode }) => children }));
vi.mock('./layouts/AppShell', () => ({ AppShell: () => <Outlet /> }));
vi.mock('./features/incidents/IncidentsPage', () => ({ IncidentsPage: () => <><p>incident list</p><DetailLink to="/incidents/record-1" state={{ listReturnTo: '/incidents?status=open' }}>open incident</DetailLink></> }));
vi.mock('./features/incidents/IncidentDetailPage', () => ({ IncidentDetailPage: () => <><h1>incident detail</h1><DetailLink to="/assets/record-1">related asset</DetailLink></> }));
vi.mock('./features/myWork/MyWorkPage', () => ({ MyWorkPage: () => <><p>work dashboard</p><DetailLink to="/incidents/record-1">open work incident</DetailLink></> }));
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


describe('detail popup navigation', () => {
  it('keeps the list mounted and returns to its filtered URL when closed', async () => {
    render(<MemoryRouter initialEntries={['/incidents?status=open']}><App /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('link', { name: 'open incident' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'incident detail' })).toBeInTheDocument();
    expect(screen.getByText('incident list')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('incident list')).toBeInTheDocument();
  });

  it('can open the same detail as a full page', async () => {
    render(<MemoryRouter initialEntries={['/incidents?status=open']}><App /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('link', { name: 'open incident' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('link', { name: '\u0e40\u0e1b\u0e34\u0e14\u0e40\u0e15\u0e47\u0e21\u0e2b\u0e19\u0e49\u0e32' }));
    expect(await screen.findByRole('heading', { name: 'incident detail' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('incident list')).not.toBeInTheDocument();
  });
  it('opens from the work dashboard and returns through related details', async () => {
    render(<MemoryRouter initialEntries={['/my-work?scope=today']}><App /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('link', { name: 'open work incident' }));
    const firstDialog = await screen.findByRole('dialog');
    expect(within(firstDialog).getByRole('heading', { name: 'incident detail' })).toBeInTheDocument();
    expect(screen.getByText('work dashboard')).toBeInTheDocument();
    fireEvent.click(within(firstDialog).getByRole('link', { name: 'related asset' }));
    expect(await screen.findByRole('heading', { name: 'asset detail' })).toBeInTheDocument();
    expect(screen.getByText('work dashboard')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(await screen.findByRole('heading', { name: 'incident detail' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('work dashboard')).toBeInTheDocument();
  });

});
