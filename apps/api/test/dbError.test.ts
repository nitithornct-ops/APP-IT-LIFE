import { describe, expect, it } from 'vitest';
import { classifyDbError, dbFail } from '../src/utils/dbError';

/**
 * ก่อนแก้ ทุกความผิดพลาดของฐานข้อมูลถูกตอบกลับเป็น 400 พร้อมข้อความดิบของ Postgres ซึ่งเปิดเผย
 * ชื่อตารางและชื่อ constraint ให้ผู้เรียก (พบจาก Pre-production QA audit 2026-08-13)
 */
describe('classifyDbError', () => {
  it.each([
    ['23505', 'duplicate', 409],
    ['23503', 'foreignKey', 409],
    ['23502', 'notNull', 400],
    ['23514', 'check', 400],
    ['22P02', 'check', 400],
    ['PGRST116', 'notFound', 404],
  ])('maps SQLSTATE %s to %s / HTTP %i', (code, kind, status) => {
    expect(classifyDbError({ code })).toEqual({ kind, status });
  });

  it('treats the PostgREST single-row message as not found even without a code', () => {
    expect(classifyDbError({ message: 'Cannot coerce the result to a single JSON object' })).toEqual({
      kind: 'notFound',
      status: 404,
    });
  });

  it('treats unknown database failures as server errors', () => {
    expect(classifyDbError({ code: 'XX000', message: 'boom' })).toEqual({ kind: 'unknown', status: 500 });
    expect(classifyDbError(null)).toEqual({ kind: 'unknown', status: 500 });
  });
});

describe('dbFail', () => {
  const duplicate = {
    code: '23505',
    message: 'duplicate key value violates unique constraint "employees_employee_code_unique"',
    details: 'Key (employee_code)=(EMP-001) already exists.',
    hint: null,
  };

  it('never puts the raw database message or constraint name in the response', () => {
    const { body } = dbFail('req-1', 'EMPLOYEE_CREATE_FAILED', duplicate);
    const serialised = JSON.stringify(body);
    expect(serialised).not.toContain('employees_employee_code_unique');
    expect(serialised).not.toContain('duplicate key value');
    expect(serialised).not.toContain('EMP-001');
  });

  it('answers a duplicate with 409 and a message a user can act on', () => {
    const { body, status } = dbFail('req-1', 'EMPLOYEE_CREATE_FAILED', duplicate);
    expect(status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('EMPLOYEE_CREATE_FAILED');
    expect(body.error.message).toContain('มีข้อมูลนี้อยู่แล้ว');
  });

  it('answers a missing row with 404 rather than 400', () => {
    const { status } = dbFail('req-1', 'EMPLOYEE_UPDATE_FAILED', {
      message: 'Cannot coerce the result to a single JSON object',
    });
    expect(status).toBe(404);
  });

  it('lets a route override the wording without exposing the database text', () => {
    const { body } = dbFail('req-1', 'CONTRACT_CREATE_FAILED', duplicate, 'เลขที่สัญญานี้มีอยู่แล้ว');
    expect(body.error.message).toBe('เลขที่สัญญานี้มีอยู่แล้ว');
    expect(JSON.stringify(body)).not.toContain('constraint');
  });

  it('keeps the request id so a server log line can be matched to what the user saw', () => {
    const { body } = dbFail('req-abc', 'X_FAILED', duplicate);
    expect(body.meta.requestId).toBe('req-abc');
  });
});
