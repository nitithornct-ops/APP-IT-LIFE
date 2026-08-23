import { DataTable } from '../../components/table/DataTable';
import { RowActions } from '../../components/table/RowActions';
import { FormModal } from '../../components/ui/Modal';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Loader2, LockKeyhole, Plus, ShieldCheck, UsersRound, X } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { RequirePermission } from '../../components/RequirePermission';
import { StatCard } from '../../components/ui/Card';
import { ApiError, apiFetch } from '../../services/apiClient';
import type { Role } from '../../types/admin';

const createRoleSchema = z.object({
  key: z
    .string()
    .trim()
    .min(2, 'อย่างน้อย 2 ตัวอักษร')
    .regex(/^[a-z][a-z0-9_]*$/, 'ใช้ตัวพิมพ์เล็ก a-z0-9_ และขึ้นต้นด้วยตัวอักษรเท่านั้น'),
  nameTh: z.string().trim().min(1, 'กรุณากรอกชื่อบทบาท'),
  nameEn: z.string().trim().optional(),
  description: z.string().trim().optional(),
});

type CreateRoleForm = z.infer<typeof createRoleSchema>;

function CreateRoleForm({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateRoleForm>({ resolver: zodResolver(createRoleSchema) });

  const mutation = useMutation({
    mutationFn: (values: CreateRoleForm) => apiFetch('/api/v1/roles', { method: 'POST', body: JSON.stringify(values) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'roles'] });
      onClose();
    },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'สร้างบทบาทไม่สำเร็จ'),
  });

  return (
    <form
      onSubmit={handleSubmit((values) => mutation.mutate(values))}
      className="mb-4 grid grid-cols-1 gap-3 rounded-md border border-slate-200 bg-white p-4 sm:grid-cols-2 dark:border-slate-700 dark:bg-slate-800"
      noValidate
    >
      <div className="sm:col-span-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">สร้างบทบาทใหม่</h2>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div>
        <label htmlFor="role-key" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
          Role key (ใช้ในระบบ ห้ามเปลี่ยนภายหลัง)
        </label>
        <input
          id="role-key"
          placeholder="เช่น service_desk_lead"
          className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('key')}
        />
        {errors.key && <p className="mt-1 text-xs text-red-600">{errors.key.message}</p>}
      </div>

      <div>
        <label htmlFor="role-nameTh" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
          ชื่อบทบาท (ไทย)
        </label>
        <input
          id="role-nameTh"
          className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('nameTh')}
        />
        {errors.nameTh && <p className="mt-1 text-xs text-red-600">{errors.nameTh.message}</p>}
      </div>

      <div>
        <label htmlFor="role-nameEn" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
          ชื่อบทบาท (อังกฤษ)
        </label>
        <input
          id="role-nameEn"
          className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('nameEn')}
        />
      </div>

      <div className="sm:col-span-2">
        <label htmlFor="role-description" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
          คำอธิบาย
        </label>
        <textarea
          id="role-description"
          rows={2}
          className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('description')}
        />
      </div>

      {serverError && <p className="sm:col-span-2 text-xs text-red-600">{serverError}</p>}

      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={isSubmitting}
          className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
        >
          {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          สร้างบทบาท
        </button>
      </div>
    </form>
  );
}

export function RolesPage() {
  const [showCreate, setShowCreate] = useState(false);

  const rolesQuery = useQuery({
    queryKey: ['admin', 'roles'],
    queryFn: () => apiFetch<Role[]>('/api/v1/roles'),
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">บทบาทและสิทธิ์</h1>
        <div className="flex items-center gap-2">
          <Link
            to="/admin/permission-matrix"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200"
          >
            Permission Matrix
          </Link>
          <RequirePermission permission="role.manage">
            <button
              type="button"
              onClick={() => setShowCreate((v) => !v)}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              สร้างบทบาทใหม่
            </button>
          </RequirePermission>
        </div>
      </div>

      {rolesQuery.data && (
        <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatCard icon={<ShieldCheck className="h-5 w-5" />} label="บทบาททั้งหมด" value={rolesQuery.data.length} tone="primary" />
          <StatCard icon={<LockKeyhole className="h-5 w-5" />} label="บทบาทระบบ" value={rolesQuery.data.filter((role) => role.is_system).length} tone="teal" />
          <StatCard icon={<UsersRound className="h-5 w-5" />} label="บทบาทกำหนดเอง" value={rolesQuery.data.filter((role) => !role.is_system).length} tone="amber" />
          <StatCard icon={<KeyRound className="h-5 w-5" />} label="พร้อมกำหนดสิทธิ์" value={rolesQuery.data.length} tone="gray" />
        </div>
      )}

      {showCreate && <FormModal title="เพิ่มบทบาท" description="กำหนดบทบาทใหม่โดยคง permission model เดิม" size="md" onClose={() => setShowCreate(false)}><CreateRoleForm onClose={() => setShowCreate(false)} /></FormModal>}

      {rolesQuery.isLoading && (
        <div className="flex justify-center py-10" role="status">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
        </div>
      )}

      {rolesQuery.data && (
        <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
          <DataTable className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2">Key</th>
                <th className="px-4 py-2">ชื่อบทบาท</th>
                <th className="px-4 py-2">คำอธิบาย</th>
                <th className="px-4 py-2">ประเภท</th>
                <th className="px-4 py-2 text-right">ดำเนินการ</th>
              </tr>
            </thead>
            <tbody>
              {rolesQuery.data.map((role) => (
                <tr key={role.id} className="border-t border-slate-100 dark:border-slate-700">
                  <td className="px-4 py-2 font-mono text-xs text-slate-600 dark:text-slate-400">{role.key}</td>
                  <td className="px-4 py-2 text-slate-800 dark:text-slate-200">{role.name_th}</td>
                  <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{role.description ?? '—'}</td>
                  <td className="px-4 py-2 text-slate-500 dark:text-slate-400">
                    {role.is_system ? 'บทบาทเริ่มต้นของระบบ' : 'กำหนดเอง'}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <RowActions
                      recordLabel={role.name_th}
                      actions={[{ kind: 'view', to: '/admin/permission-matrix', label: 'ดูสิทธิ์' }]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </div>
      )}
    </div>
  );
}
