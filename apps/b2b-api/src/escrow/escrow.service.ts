import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { money } from '@clairtus/shared';
import {
  applyEscrowEvent,
  computeFeeBreakdown,
  EscrowTransitionError,
  buildFundPosting,
  buildReleasePosting,
  buildRefundPosting,
  buildPayoutPosting,
  type EscrowStatus,
  type EscrowEventType,
  type FeeResponsibility,
} from '@clairtus/core';
import { Ledger, type AccountType } from '@clairtus/ledger';
import type { PaymentRail } from '@clairtus/payments';
import type { ApiKeyMode } from '@clairtus/tenancy';
import { SQL, RAIL, SIMULATED_RAIL, type SqlExecutor } from '../db/sql';
import { WebhookService } from '../webhooks/webhook.service';
import { ComplianceService } from './compliance';
import { buildPage, decodeCursor } from '../common/pagination';
import type { CreatePartyDto, CreateEscrowDto, CreatePayoutDto } from './escrow.dto';

/** Cursor-pagination query options for list endpoints. */
export interface ListOptions {
  limit?: number;
  cursor?: string;
}
/** Clamp a requested page size into a safe range (default 50, max 100). */
function pageLimit(limit?: number): number {
  if (!limit || !Number.isFinite(limit) || limit <= 0) return 50;
  return Math.min(Math.floor(limit), 100);
}

export type { CreatePartyDto, CreateEscrowDto, CreatePayoutDto } from './escrow.dto';

interface EscrowRow {
  id: string; status: EscrowStatus; base_amount: string | number; currency: string;
  fee_bps: number; fee_responsibility: FeeResponsibility; buyer_party_id: string | null;
  seller_party_id: string; secondary_party_id: string | null; secondary_amount: string | number;
  held_account_id: string; created_at: string; updated_at: string;
}

const num = (v: string | number): number => Number(v);

@Injectable()
export class EscrowService {
  private readonly ledger: Ledger;

  constructor(
    @Inject(SQL) private readonly sql: SqlExecutor,
    @Inject(RAIL) private readonly rail: PaymentRail | null,
    @Inject(SIMULATED_RAIL) private readonly simulatedRail: PaymentRail | null,
    private readonly compliance: ComplianceService,
    private readonly webhooks: WebhookService,
  ) {
    this.ledger = new Ledger(sql);
  }

  // ---- parties -----------------------------------------------------------

  async createParty(tenantId: string, dto: CreatePartyDto) {
    if (!dto.role) throw new BadRequestException('role is required');
    const { rows } = await this.sql.query<{ id: string; created_at: string }>(
      `insert into parties (tenant_id, role, name, phone, account_ref, bank_code)
       values ($1,$2,$3,$4,$5,$6) returning id, created_at`,
      [tenantId, dto.role, dto.name ?? null, dto.phone ?? null, dto.accountRef ?? null, dto.bankCode ?? null],
    );
    return { id: rows[0]!.id, role: dto.role, name: dto.name ?? null, createdAt: rows[0]!.created_at };
  }

  async getParty(tenantId: string, id: string) {
    const { rows } = await this.sql.query<{ id: string; role: string; name: string | null; kyc_status: string; kyc_result_code: string | null; created_at: string }>(
      `select id, role, name, kyc_status, kyc_result_code, created_at from parties where id = $1 and tenant_id = $2`,
      [id, tenantId],
    );
    if (rows.length === 0) throw new NotFoundException('party not found');
    const r = rows[0]!;
    return { id: r.id, role: r.role, name: r.name, kycStatus: r.kyc_status, kycResultCode: r.kyc_result_code, createdAt: r.created_at };
  }

  private async assertPartyExists(tenantId: string, id: string, label: string): Promise<void> {
    const { rows } = await this.sql.query(`select 1 from parties where id = $1 and tenant_id = $2`, [id, tenantId]);
    if (rows.length === 0) throw new BadRequestException(`${label} party not found`);
  }

  /** The tenant's market (ISO-2 country) — drives per-market compliance rules + KYC tiers. */
  private async tenantCountry(tenantId: string): Promise<string> {
    const { rows } = await this.sql.query<{ country: string | null }>(
      `select country from tenants where id = $1`,
      [tenantId],
    );
    return rows[0]?.country ?? '';
  }

  // ---- escrows -----------------------------------------------------------

  async createEscrow(tenantId: string, dto: CreateEscrowDto) {
    if (!Number.isInteger(dto.baseAmount) || dto.baseAmount <= 0) {
      throw new BadRequestException('baseAmount must be a positive integer (minor units)');
    }
    await this.assertPartyExists(tenantId, dto.sellerPartyId, 'seller');
    const secondaryAmount = dto.secondaryAmount ?? 0;
    if (secondaryAmount > 0) {
      if (!dto.secondaryPartyId) throw new BadRequestException('secondaryPartyId required when secondaryAmount > 0');
      await this.assertPartyExists(tenantId, dto.secondaryPartyId, 'secondary');
    }

    // Compliance: per-market amount bounds + cumulative volume limits (422 on violation); records the decision.
    const country = await this.tenantCountry(tenantId);
    await this.compliance.assertCreateAllowed({
      tenantId,
      country,
      currency: dto.currency,
      baseAmountMinor: dto.baseAmount,
      buyerPartyId: dto.buyerPartyId ?? null,
      sellerPartyId: dto.sellerPartyId,
    });

    // A fresh held account per escrow (linked by held_account_id).
    const held = await this.ledger.createAccount({ tenantId, type: 'escrow_held', currency: dto.currency });
    const { rows } = await this.sql.query<{ id: string }>(
      `insert into escrows (tenant_id, status, base_amount, currency, fee_bps, fee_responsibility,
         buyer_party_id, seller_party_id, secondary_party_id, secondary_amount, held_account_id)
       values ($1,'DRAFT',$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [tenantId, dto.baseAmount, dto.currency, dto.feeBps, dto.feeResponsibility,
        dto.buyerPartyId ?? null, dto.sellerPartyId, dto.secondaryPartyId ?? null, secondaryAmount, held.id],
    );
    return this.getEscrow(tenantId, rows[0]!.id);
  }

  async getEscrow(tenantId: string, id: string) {
    const row = await this.loadEscrow(tenantId, id);
    return this.toEscrowDto(row);
  }

  async fund(tenantId: string, id: string) {
    const e = await this.loadEscrow(tenantId, id);
    // Synchronous sandbox funding: request → confirm, then post the deposit into held.
    let status: EscrowStatus = e.status;
    if (status === 'DRAFT') status = this.transition(status, 'REQUEST_FUNDING');
    status = this.transition(status, 'FUNDING_CONFIRMED');

    const breakdown = this.breakdown(e);
    const external = await this.account(tenantId, 'external', e.currency, null);
    await this.ledger.post(
      buildFundPosting({
        tenantId, reference: `fund:${id}`, currency: e.currency, escrowId: id,
        depositAmount: breakdown.depositAmount.amount,
        accounts: { external, held: e.held_account_id },
      }),
    );
    await this.setStatus(tenantId, id, status);
    await this.webhooks.emit(tenantId, { type: 'escrow.funded', escrowId: id, data: { depositAmount: breakdown.depositAmount.amount } });
    return { ...(await this.getEscrow(tenantId, id)), depositAmount: breakdown.depositAmount.amount };
  }

  async release(tenantId: string, id: string) {
    const e = await this.loadEscrow(tenantId, id);
    const event: EscrowEventType = e.status === 'DISPUTED' ? 'RESOLVE_RELEASE' : 'RELEASE';
    const status = this.transition(e.status, event);

    // KYC gate (per-market tier): higher-ticket releases require a VERIFIED seller (compliance step-up).
    const country = await this.tenantCountry(tenantId);
    const kycThresholdMinor = this.compliance.releaseKycThresholdMinor(country, e.currency);
    if (kycThresholdMinor > 0 && num(e.base_amount) > kycThresholdMinor) {
      const k = await this.sql.query<{ kyc_status: string }>(
        `select kyc_status from parties where id = $1 and tenant_id = $2`,
        [e.seller_party_id, tenantId],
      );
      if (k.rows[0]?.kyc_status !== 'VERIFIED') {
        throw new ForbiddenException(
          `seller KYC verification required to release above ${kycThresholdMinor} (minor units) for market ${country}`,
        );
      }
    }

    const breakdown = this.breakdown(e);
    const accounts = {
      external: await this.account(tenantId, 'external', e.currency, null),
      held: e.held_account_id,
      primaryRecipient: await this.account(tenantId, 'recipient_payable', e.currency, e.seller_party_id),
      revenue: await this.account(tenantId, 'clairtus_revenue', e.currency, null),
      ...(breakdown.secondaryNet.amount > 0
        ? { secondaryRecipient: await this.account(tenantId, 'recipient_payable', e.currency, e.secondary_party_id!) }
        : {}),
    };
    await this.ledger.post(
      buildReleasePosting({ tenantId, reference: `release:${id}`, currency: e.currency, escrowId: id, breakdown, accounts }),
    );
    await this.setStatus(tenantId, id, status);
    await this.webhooks.emit(tenantId, { type: 'escrow.released', escrowId: id, data: { primaryNet: breakdown.primaryNet.amount, revenue: breakdown.platformRevenue.amount } });
    return this.getEscrow(tenantId, id);
  }

  async refund(tenantId: string, id: string) {
    const e = await this.loadEscrow(tenantId, id);
    const event: EscrowEventType = e.status === 'DISPUTED' ? 'RESOLVE_REFUND' : 'REFUND';
    const status = this.transition(e.status, event);

    const breakdown = this.breakdown(e);
    const external = await this.account(tenantId, 'external', e.currency, null);
    await this.ledger.post(
      buildRefundPosting({
        tenantId, reference: `refund:${id}`, currency: e.currency, escrowId: id,
        depositAmount: breakdown.depositAmount.amount,
        accounts: { held: e.held_account_id, external },
      }),
    );
    await this.setStatus(tenantId, id, status);
    await this.webhooks.emit(tenantId, { type: 'escrow.refunded', escrowId: id, data: { depositAmount: breakdown.depositAmount.amount } });
    return this.getEscrow(tenantId, id);
  }

  async cancel(tenantId: string, id: string) {
    const e = await this.loadEscrow(tenantId, id);
    await this.setStatus(tenantId, id, this.transition(e.status, 'CANCEL'));
    await this.webhooks.emit(tenantId, { type: 'escrow.cancelled', escrowId: id });
    return this.getEscrow(tenantId, id);
  }

  async dispute(tenantId: string, id: string) {
    const e = await this.loadEscrow(tenantId, id);
    await this.setStatus(tenantId, id, this.transition(e.status, 'OPEN_DISPUTE'));
    await this.webhooks.emit(tenantId, { type: 'escrow.disputed', escrowId: id });
    return this.getEscrow(tenantId, id);
  }

  // ---- payouts -----------------------------------------------------------

  async createPayout(tenantId: string, dto: CreatePayoutDto, mode: ApiKeyMode = 'live') {
    if (!Number.isInteger(dto.amount) || dto.amount <= 0) throw new BadRequestException('amount must be a positive integer');
    const escrow = await this.loadEscrow(tenantId, dto.escrowId);
    await this.assertPartyExists(tenantId, dto.recipientPartyId, 'recipient');

    const recipientAccount = await this.account(tenantId, 'recipient_payable', escrow.currency, dto.recipientPartyId);
    const owed = await this.ledger.getBalance(recipientAccount);
    if (dto.amount > owed) {
      throw new UnprocessableEntityException(`cannot pay out ${dto.amount}: only ${owed} owed to recipient`);
    }
    const external = await this.account(tenantId, 'external', escrow.currency, null);

    const ins = await this.sql.query<{ id: string; created_at: string }>(
      `insert into payouts (tenant_id, escrow_id, recipient_party_id, amount, currency, status)
       values ($1,$2,$3,$4,$5,'pending') returning id, created_at`,
      [tenantId, dto.escrowId, dto.recipientPartyId, dto.amount, escrow.currency],
    );
    const payoutId = ins.rows[0]!.id;

    // Sandbox parity: test-mode keys disburse through the simulated rail; live keys through the real rail.
    const rail = mode === 'live' ? this.rail : this.simulatedRail;

    let railId: string | null = null;
    let railRef: string | null = null;
    let status = 'pending';
    if (rail) {
      const party = await this.sql.query<{ account_ref: string | null; bank_code: string | null; name: string | null }>(
        `select account_ref, bank_code, name from parties where id = $1 and tenant_id = $2`,
        [dto.recipientPartyId, tenantId],
      );
      const p = party.rows[0]!;
      const res = await rail.initiatePayout({
        reference: payoutId, amount: dto.amount, currency: escrow.currency, country: '',
        method: 'bank_transfer',
        recipient: { accountRef: p.account_ref ?? undefined, bankCode: p.bank_code ?? undefined, name: p.name ?? undefined },
        metadata: dto.metadata,
      });
      railId = rail.id; railRef = res.railRef; status = res.status;
      await this.sql.query(`update payouts set rail = $1, rail_ref = $2, status = $3 where id = $4 and tenant_id = $5`,
        [railId, railRef, status, payoutId, tenantId]);
    }

    // A FAILED disbursement must not move funds out of the recipient balance.
    if (status !== 'failed') {
      await this.ledger.post(
        buildPayoutPosting({
          tenantId, reference: `payout:${payoutId}`, currency: escrow.currency, escrowId: dto.escrowId,
          amount: dto.amount, recipientAccount, externalAccount: external,
        }),
      );
    }

    await this.webhooks.emit(tenantId, {
      type: status === 'failed' ? 'payout.failed' : 'payout.succeeded',
      escrowId: dto.escrowId,
      data: { payoutId, amount: dto.amount, railRef },
    });
    return { id: payoutId, escrowId: dto.escrowId, recipientPartyId: dto.recipientPartyId, amount: dto.amount, currency: escrow.currency, rail: railId, railRef, status, createdAt: ins.rows[0]!.created_at };
  }

  async getPayout(tenantId: string, id: string) {
    const { rows } = await this.sql.query<Record<string, unknown>>(
      `select id, escrow_id, recipient_party_id, amount, currency, rail, rail_ref, status, created_at
       from payouts where id = $1 and tenant_id = $2`,
      [id, tenantId],
    );
    if (rows.length === 0) throw new NotFoundException('payout not found');
    const r = rows[0]! as any;
    return { id: r.id, escrowId: r.escrow_id, recipientPartyId: r.recipient_party_id, amount: num(r.amount), currency: r.currency, rail: r.rail, railRef: r.rail_ref, status: r.status, createdAt: r.created_at };
  }

  // ---- balances & ledger -------------------------------------------------

  async listBalances(tenantId: string) {
    const { rows } = await this.sql.query<{ id: string; type: AccountType; owner_ref: string | null; currency: string }>(
      `select id, type, owner_ref, currency from ledger_accounts where tenant_id = $1 order by type`,
      [tenantId],
    );
    const balances = [];
    for (const a of rows) {
      balances.push({ accountId: a.id, type: a.type, ownerRef: a.owner_ref, currency: a.currency, balance: await this.ledger.getBalance(a.id) });
    }
    return { data: balances };
  }

  async listLedger(tenantId: string, opts: ListOptions = {}) {
    const limit = pageLimit(opts.limit);
    const cur = opts.cursor ? decodeCursor(opts.cursor) : null;
    const where = cur ? `and (e.created_at, e.id) < ($3, $4)` : ``;
    const params = cur ? [tenantId, limit + 1, cur.createdAt, cur.id] : [tenantId, limit + 1];
    const { rows } = await this.sql.query<Record<string, unknown>>(
      `select e.id, e.account_id, e.direction, e.amount, e.created_at, pg.reference, pg.escrow_id
       from ledger_entries e
       join ledger_posting_groups pg on pg.id = e.posting_group_id
       where pg.tenant_id = $1 ${where}
       order by e.created_at desc, e.id desc
       limit $2`,
      params,
    );
    const data = rows.map((r: any) => ({ id: r.id as string, accountId: r.account_id, direction: r.direction, amount: num(r.amount), reference: r.reference, escrowId: r.escrow_id, createdAt: r.created_at as string }));
    return buildPage(data, limit);
  }

  // ---- lists -------------------------------------------------------------

  async listEscrows(tenantId: string, opts: ListOptions = {}) {
    const limit = pageLimit(opts.limit);
    const cur = opts.cursor ? decodeCursor(opts.cursor) : null;
    const where = cur ? `and (created_at, id) < ($3, $4)` : ``;
    const params = cur ? [tenantId, limit + 1, cur.createdAt, cur.id] : [tenantId, limit + 1];
    const { rows } = await this.sql.query<EscrowRow>(
      `select * from escrows where tenant_id = $1 ${where} order by created_at desc, id desc limit $2`,
      params,
    );
    return buildPage(rows.map((r) => this.toEscrowDto(r)), limit);
  }

  async listPayouts(tenantId: string, opts: ListOptions = {}) {
    const limit = pageLimit(opts.limit);
    const cur = opts.cursor ? decodeCursor(opts.cursor) : null;
    const where = cur ? `and (created_at, id) < ($3, $4)` : ``;
    const params = cur ? [tenantId, limit + 1, cur.createdAt, cur.id] : [tenantId, limit + 1];
    const { rows } = await this.sql.query<Record<string, unknown>>(
      `select id, escrow_id, recipient_party_id, amount, currency, rail, rail_ref, status, created_at
       from payouts where tenant_id = $1 ${where} order by created_at desc, id desc limit $2`,
      params,
    );
    const data = rows.map((r: any) => ({
      id: r.id as string, escrowId: r.escrow_id, recipientPartyId: r.recipient_party_id, amount: num(r.amount),
      currency: r.currency, rail: r.rail, railRef: r.rail_ref, status: r.status, createdAt: r.created_at as string,
    }));
    return buildPage(data, limit);
  }

  // ---- internals ---------------------------------------------------------

  private async loadEscrow(tenantId: string, id: string): Promise<EscrowRow> {
    const { rows } = await this.sql.query<EscrowRow>(`select * from escrows where id = $1 and tenant_id = $2`, [id, tenantId]);
    if (rows.length === 0) throw new NotFoundException('escrow not found');
    return rows[0]!;
  }

  private transition(status: EscrowStatus, event: EscrowEventType): EscrowStatus {
    try {
      return applyEscrowEvent({ status }, event).state.status;
    } catch (err) {
      if (err instanceof EscrowTransitionError) throw new ConflictException(err.message);
      throw err;
    }
  }

  private breakdown(e: EscrowRow) {
    const currency = e.currency;
    const secondary = num(e.secondary_amount);
    return computeFeeBreakdown({
      base: money(num(e.base_amount), currency),
      feeBps: e.fee_bps,
      feeResponsibility: e.fee_responsibility,
      ...(secondary > 0 ? { secondaryGross: money(secondary, currency) } : {}),
    });
  }

  /** Resolve (or create) a shared ledger account by (tenant, type, currency, ownerRef). */
  private async account(tenantId: string, type: AccountType, currency: string, ownerRef: string | null): Promise<string> {
    const sel = await this.sql.query<{ id: string }>(
      `select id from ledger_accounts where tenant_id = $1 and type = $2 and currency = $3 and owner_ref is not distinct from $4`,
      [tenantId, type, currency, ownerRef],
    );
    if (sel.rows.length > 0) return sel.rows[0]!.id;
    const acc = await this.ledger.createAccount({ tenantId, type, currency, ownerRef });
    return acc.id;
  }

  private async setStatus(tenantId: string, id: string, status: EscrowStatus): Promise<void> {
    await this.sql.query(`update escrows set status = $1, updated_at = now() where id = $2 and tenant_id = $3`, [status, id, tenantId]);
  }

  private toEscrowDto(r: EscrowRow) {
    return {
      id: r.id, status: r.status, baseAmount: num(r.base_amount), currency: r.currency,
      feeBps: r.fee_bps, feeResponsibility: r.fee_responsibility,
      buyerPartyId: r.buyer_party_id, sellerPartyId: r.seller_party_id,
      secondaryPartyId: r.secondary_party_id, secondaryAmount: num(r.secondary_amount),
      createdAt: r.created_at, updatedAt: r.updated_at,
    };
  }
}
