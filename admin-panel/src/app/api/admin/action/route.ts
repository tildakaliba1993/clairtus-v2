// admin-panel/src/app/api/admin/action/route.ts
// Server-side proxy for admin actions — keeps ADMIN_SECRET out of the client bundle.
// The client sends its Supabase JWT; this route validates it then forwards the action
// to the Supabase edge function using the server-only ADMIN_SECRET.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const adminSecret = process.env.ADMIN_SECRET || ''; // server-only, never NEXT_PUBLIC_

export async function POST(request: NextRequest) {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.split(' ')[1];
    const authClient = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '');
    const { data: { user }, error: authError } = await authClient.auth.getUser(token);
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!adminSecret) {
        return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const body = await request.json();

    const edgeFnUrl = `${supabaseUrl}/functions/v1/admin-actions`;
    const response = await fetch(edgeFnUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminSecret}`,
        },
        body: JSON.stringify(body),
    });

    const data = await response.json().catch(() => ({}));
    return NextResponse.json(data, { status: response.status });
}
