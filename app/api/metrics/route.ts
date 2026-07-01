import { NextResponse } from 'next/server';
import client from 'prom-client';

export async function GET() {
  return new NextResponse(await client.register.metrics(), {
    headers: { 'Content-Type': client.register.contentType }
  });
}
