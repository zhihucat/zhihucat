import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { HttpError } from './types.ts';

export function serverUrl(server: Server): string {
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

/** Tests declare the expected response contract, then assert its actual fields. */
export async function responseJson<T>(response: Response): Promise<T> {
  return await response.json() as T;
}

export function requestBody(init: RequestInit): unknown {
  assert.equal(typeof init.body, 'string');
  return JSON.parse(init.body as string) as unknown;
}

export function isHttpError(error: unknown): error is HttpError {
  return error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number';
}

export type ApiData<T> = { data: T };
export type ApiError = { error: { message: string } };
