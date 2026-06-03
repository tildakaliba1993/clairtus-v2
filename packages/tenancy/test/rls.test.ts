import { describe, it, expect, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { Tenancy, tenantRlsSql, withTenant, type SqlExecutor } from '../src';

/**
 * Proves invariant #4 — tenant A can never read/write tenant B's data — via Postgres
 * Row-Level Security. pglite connects as a superuser (who bypasses RLS), so we model
 * the production split: schema/seed run as the privileged service role, while tenant-
 * scoped access runs as a NON-superuser role (`set local role app_user`) — exactly how
 * Supabase's `authenticated` role behaves behind the API.
 */
function adminExecutor(db: PGlite): SqlExecutor {
  return {
    async query(sql, params) {
      const r = await db.query(sql, params as never);
      return { rows: r.rows as never[] };
    },
    async transaction(fn) {
      return db.transaction(async (tx) =>
        fn({
          async query(sql, params) {
            const r = await tx.query(sql, params as never);
            return { rows: r.rows as never[] };
          },
          transaction() { throw new Error('nested'); },
        }),
      ) as never;
    },
  };
}

/** Executor that runs every transaction as the restricted, RLS-subject role. */
function tenantScopedExecutor(db: PGlite, role = 'app_user'): SqlExecutor {
  return {
    async query(sql, params) {
      const r = await db.query(sql, params as never);
      return { rows: r.rows as never[] };
    },
    async transaction(fn) {
      return db.transaction(async (tx) => {
        await tx.query(`set local role ${role}`);
        return fn({
          async query(sql, params) {
            const r = await tx.query(sql, params as never);
            return { rows: r.rows as never[] };
          },
          transaction() { throw new Error('nested'); },
        });
      }) as never;
    },
  };
}

let db: PGlite;
let admin: SqlExecutor;
let tenantScoped: SqlExecutor;
let tenantA: string;
let tenantB: string;

beforeEach(async () => {
  db = new PGlite();
  admin = adminExecutor(db);
  tenantScoped = tenantScopedExecutor(db);

  const tenancy = new Tenancy(admin);
  await tenancy.init();
  tenantA = (await tenancy.createTenant({ name: 'A', country: 'ZA' })).id;
  tenantB = (await tenancy.createTenant({ name: 'B', country: 'NG' })).id;

  // A representative tenant-scoped data table protected by the shared RLS helper.
  await db.exec(`create role app_user nosuperuser nobypassrls`);
  await db.exec(`create table escrows (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, ref text not null)`);
  await db.exec(tenantRlsSql('escrows'));
  await db.exec(`grant select, insert, update, delete on escrows to app_user`);

  // Seed both tenants' rows as the privileged role (bypasses RLS).
  await db.query(`insert into escrows (tenant_id, ref) values ($1,'A-esc'), ($2,'B-esc')`, [tenantA, tenantB]);
});

describe('invariant #4: RLS tenant isolation', () => {
  it('a tenant reads ONLY its own rows', async () => {
    const aRows = await withTenant(tenantScoped, tenantA, (tx) =>
      tx.query<{ ref: string }>(`select ref from escrows`),
    );
    const bRows = await withTenant(tenantScoped, tenantB, (tx) =>
      tx.query<{ ref: string }>(`select ref from escrows`),
    );
    expect(aRows.rows.map((r) => r.ref)).toEqual(['A-esc']);
    expect(bRows.rows.map((r) => r.ref)).toEqual(['B-esc']);
  });

  it('with no tenant context, RLS denies everything (no rows, no error)', async () => {
    const rows = await tenantScoped.transaction((tx) =>
      tx.query<{ ref: string }>(`select ref from escrows`),
    );
    expect(rows.rows).toEqual([]);
  });

  it('a tenant cannot INSERT a row tagged with another tenant (WITH CHECK)', async () => {
    await expect(
      withTenant(tenantScoped, tenantA, (tx) =>
        tx.query(`insert into escrows (tenant_id, ref) values ($1, 'sneaky')`, [tenantB]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('a tenant cannot UPDATE another tenant\'s row', async () => {
    await withTenant(tenantScoped, tenantA, (tx) =>
      tx.query(`update escrows set ref = 'hacked' where tenant_id = $1`, [tenantB]),
    );
    // B's row is untouched (A's update matched zero visible rows).
    const bRows = await withTenant(tenantScoped, tenantB, (tx) =>
      tx.query<{ ref: string }>(`select ref from escrows`),
    );
    expect(bRows.rows.map((r) => r.ref)).toEqual(['B-esc']);
  });
});
