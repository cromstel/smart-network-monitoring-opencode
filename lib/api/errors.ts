import { NextResponse } from 'next/server'

export type ErrorCode =
  | 'INVALID_QUERY'
  | 'INVALID_BODY'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'SCANNER_UNAVAILABLE'
  | 'ROUTER_UNREACHABLE'
  | 'INTERNAL'

export function apiError(
  status: number,
  code: ErrorCode,
  message: string,
  details?: unknown
): NextResponse {
  return NextResponse.json(
    {
      error: code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
    { status }
  )
}