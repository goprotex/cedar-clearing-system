import { NextResponse } from 'next/server';
import { createClient, getUserFromRequest } from '@/utils/supabase/server';
import { isCompanyAdmin } from '@/lib/company-admin';
import { createServiceRoleClient } from '@/utils/supabase/admin';

const MAX_EMAIL_LEN = 200;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * POST /api/company/invite
 * Send a Supabase Auth invite email to a new user.
 * Only company admins (owner/manager) can invite.
 * If the user already exists in auth.users, returns 409.
 */
export async function POST(req: Request) {
  const supabase = await createClient(req);
  const { data: auth } = await getUserFromRequest(supabase, req);
  const userId = auth.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!(await isCompanyAdmin(supabase, userId))) {
    return NextResponse.json({ error: 'Forbidden — company owners and managers only' }, { status: 403 });
  }

  // Resolve the caller's company_id
  const { data: profile } = await supabase
    .from('profiles')
    .select('company_id')
    .eq('id', userId)
    .maybeSingle();
  const companyId = profile?.company_id;
  if (!companyId) {
    return NextResponse.json({ error: 'No company linked to your profile' }, { status: 400 });
  }

  let body: { email?: string; role?: string; fullName?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? normalizeEmail(body.email).slice(0, MAX_EMAIL_LEN) : '';
  if (!email || !isValidEmail(email)) {
    return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
  }

  const role = ['owner', 'manager', 'operator', 'crew_lead', 'viewer'].includes(body.role ?? '')
    ? body.role!
    : 'operator';

  const fullName = typeof body.fullName === 'string' ? body.fullName.trim().slice(0, 200) : '';

  const admin = createServiceRoleClient();
  if (!admin) {
    return NextResponse.json(
      { error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY. Ask the system admin to configure it.' },
      { status: 503 },
    );
  }

  // Fetch company name for the invite email metadata
  const { data: company } = await supabase
    .from('companies')
    .select('name')
    .eq('id', companyId)
    .maybeSingle();

  const companyName = company?.name ?? 'Cedar Clearing';

  // Use Supabase Auth admin to invite the user by email.
  // This sends a magic-link style email that creates the account on first click.
  const { data: inviteData, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
    data: {
      company_id: companyId,
      role,
      full_name: fullName || undefined,
      invited_by: userId,
      company_name: companyName,
    },
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || ''}/auth/callback?next=/settings`,
  });

  if (inviteErr) {
    // Supabase returns a specific error when user already exists
    const msg = inviteErr.message ?? '';
    if (msg.includes('already been registered') || msg.includes('already exists')) {
      return NextResponse.json(
        { error: 'A user with this email already has an account. Add them to a job via the team invite instead.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // Auto-create the profile row for the invited user so they're linked to the company
  // when they first sign in.
  if (inviteData?.user?.id) {
    await admin.from('profiles').upsert(
      {
        id: inviteData.user.id,
        company_id: companyId,
        role,
        full_name: fullName || null,
      },
      { onConflict: 'id' },
    );
  }

  return NextResponse.json({
    ok: true,
    userId: inviteData?.user?.id ?? null,
    email,
    message: `Invite email sent to ${email}. They will be added to ${companyName} when they accept.`,
  });
}
