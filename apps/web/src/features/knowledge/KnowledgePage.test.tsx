import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { KnowledgePage } from './KnowledgePage';

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../../services/apiClient', async (load) => ({ ...(await load<typeof import('../../services/apiClient')>()), apiFetch: mocks.api }));
vi.mock('../../stores/authContext', () => ({ useAuth: () => ({ hasPermission: () => false }) }));
afterEach(() => { cleanup(); mocks.api.mockReset(); });

it('asks the server to search rather than filtering only the first loaded articles', async () => {
  mocks.api.mockImplementation((url: string) => Promise.resolve({
    articles: url.includes('search=') ? [{ id: 'older', article_code: 'KB-OLD', title: 'Older match', solution: 'Solution', status: 'เผยแพร่', views_count: 0, helpful_count: 0, tags: [] }] : [],
    categories: [], taxonomies: [], canManage: false, hasMore: false,
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><KnowledgePage /></MemoryRouter></QueryClientProvider>);
  const search = await screen.findByPlaceholderText('ค้นหาอาการ วิธีแก้ แท็ก หรือ synonym...');
  fireEvent.change(search, { target: { value: 'Older match' } });
  expect(await screen.findByText('Older match')).toBeVisible();
  expect(mocks.api).toHaveBeenCalledWith('/api/v1/knowledge?search=Older+match');
});
