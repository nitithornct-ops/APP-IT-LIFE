import type { ApiErrorDetail, ApiErrorResponse, ApiSuccessResponse } from '@itlife/shared';

function meta(requestId: string) {
  return { requestId, timestamp: new Date().toISOString() };
}

export function ok<T>(requestId: string, data: T): ApiSuccessResponse<T> {
  return { success: true, data, meta: meta(requestId) };
}

export function fail(
  requestId: string,
  code: string,
  message: string,
  details: ApiErrorDetail[] = [],
): ApiErrorResponse {
  return { success: false, error: { code, message, details }, meta: meta(requestId) };
}
