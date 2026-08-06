import { useMemo } from 'react';
import { NAV_GROUPS, type NavGroup } from '../config/navigation';
import { useAuth } from '../stores/authContext';

/** กรองเมนูตามสิทธิ์จริงของผู้ใช้ปัจจุบัน — ใช้ผลลัพธ์นี้ทั้ง Sidebar และ Command Palette */
export function useNavItems(): NavGroup[] {
  const { hasPermission, isMeLoading } = useAuth();

  return useMemo(() => {
    if (isMeLoading) return [];
    return NAV_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (item.permission) return hasPermission(item.permission);
        if (item.anyPermission) return item.anyPermission.some((key) => hasPermission(key));
        return true;
      }),
    })).filter((group) => group.items.length > 0);
  }, [hasPermission, isMeLoading]);
}
