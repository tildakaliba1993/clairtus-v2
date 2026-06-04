import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { KycProvider } from '@clairtus/kyc';
import { SQL, KYC_PROVIDER, KYC_CALLBACK_URL, type SqlExecutor } from '../db/sql';
import { WebhookService } from '../webhooks/webhook.service';
import type { CreateKycCheckDto } from './kyc.dto';

export type { CreateKycCheckDto } from './kyc.dto';

@Injectable()
export class KycService {
  constructor(
    @Inject(SQL) private readonly sql: SqlExecutor,
    @Inject(KYC_PROVIDER) private readonly provider: KycProvider | null,
    @Inject(KYC_CALLBACK_URL) private readonly callbackUrl: string,
    private readonly webhooks: WebhookService,
  ) {}

  /** Start a verification for a party; returns the SDK session token. */
  async createCheck(tenantId: string, dto: CreateKycCheckDto) {
    if (!this.provider) throw new ServiceUnavailableException('KYC provider not configured');
    const party = await this.sql.query<{ phone: string | null }>(
      `select phone from parties where id = $1 and tenant_id = $2`,
      [dto.partyId, tenantId],
    );
    if (party.rows.length === 0) throw new NotFoundException('party not found');

    const res = await this.provider.startVerification({
      partyRef: dto.partyId,
      contact: party.rows[0]!.phone ?? undefined,
      level: dto.level,
      callbackUrl: this.callbackUrl,
    });
    const ins = await this.sql.query<{ id: string; created_at: string }>(
      `insert into kyc_checks (tenant_id, party_id, provider, status, job_id)
       values ($1,$2,$3,'PENDING',$4) returning id, created_at`,
      [tenantId, dto.partyId, this.provider.id, res.jobId],
    );
    return {
      id: ins.rows[0]!.id, partyId: dto.partyId, provider: this.provider.id, status: 'PENDING',
      token: res.token, environment: res.environment, createdAt: ins.rows[0]!.created_at,
    };
  }

  async getCheck(tenantId: string, id: string) {
    const { rows } = await this.sql.query<Record<string, unknown>>(
      `select id, party_id, provider, status, result_code, job_id, created_at, updated_at
       from kyc_checks where id = $1 and tenant_id = $2`,
      [id, tenantId],
    );
    if (rows.length === 0) throw new NotFoundException('kyc check not found');
    const r = rows[0]! as any;
    return { id: r.id, partyId: r.party_id, provider: r.provider, status: r.status, resultCode: r.result_code, jobId: r.job_id, createdAt: r.created_at, updatedAt: r.updated_at };
  }

  /**
   * Handle a provider callback (NOT API-key authenticated — verified by the provider
   * signature). Updates the party's KYC status + the latest check, then emits kyc.completed.
   */
  async handleCallback(body: unknown, headers: Record<string, string>) {
    if (!this.provider) throw new ServiceUnavailableException('KYC provider not configured');
    if (!this.provider.verifyCallback(body, headers)) throw new UnauthorizedException('invalid callback signature');
    const norm = this.provider.parseCallback(body, headers);
    if (!norm) throw new BadRequestException('unparseable callback');
    if (!norm.isFinal) return { ok: true, ignored: 'intermediate result' };

    // partyRef is our (globally-unique) party id; derive the tenant from it.
    const pr = await this.sql.query<{ tenant_id: string }>(`select tenant_id from parties where id = $1`, [norm.partyRef]);
    if (pr.rows.length === 0) return { ok: true, ignored: 'unknown party' };
    const tenantId = pr.rows[0]!.tenant_id;

    await this.sql.query(`update parties set kyc_status = $1, kyc_result_code = $2 where id = $3`, [norm.status, norm.resultCode, norm.partyRef]);
    await this.sql.query(
      `update kyc_checks set status = $1, result_code = $2, updated_at = now() where party_id = $3 and tenant_id = $4`,
      [norm.status, norm.resultCode, norm.partyRef, tenantId],
    );
    await this.webhooks.emit(tenantId, { type: 'kyc.completed', data: { partyId: norm.partyRef, status: norm.status, resultCode: norm.resultCode } });
    return { ok: true, status: norm.status };
  }
}
