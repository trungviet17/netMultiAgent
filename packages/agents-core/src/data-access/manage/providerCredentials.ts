import { createHash } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { AgentsManageDatabaseClient } from '../../db/manage/manage-client';
import { providerCredentials } from '../../db/manage/manage-schema';
import type { ProjectScopeConfig } from '../../types/index';
import { decryptSecret, encryptSecret, maskSecret } from '../../utils/secret-encryption';
import type { ProviderCredentialProvider } from '../../validation/schemas';
import { projectScopedWhere } from './scope-helpers';

export type ProviderCredentialRow = typeof providerCredentials.$inferSelect;

export type ProviderCredentialPublic = {
  id: string;
  tenantId: string;
  projectId: string;
  provider: ProviderCredentialProvider;
  label: string | null;
  baseUrl: string | null;
  enabled: boolean;
  keyPreview: string;
  lastTestStatus: 'success' | 'failure' | 'pending' | null;
  lastTestMessage: string | null;
  lastTestedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function fingerprint(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex').slice(0, 16);
}

function rowToPublic(row: ProviderCredentialRow): ProviderCredentialPublic {
  let preview = '••••';
  try {
    const plain = decryptSecret({
      ciphertext: row.encryptedKey,
      iv: row.encryptionIv,
      authTag: row.authTag,
    });
    preview = maskSecret(plain);
  } catch {
    // Decryption fails when the master key rotates without re-encrypting.
    // Return a placeholder so listing still works; rotation is a separate concern.
    preview = '••••';
  }
  return {
    id: row.id,
    tenantId: row.tenantId,
    projectId: row.projectId,
    provider: row.provider as ProviderCredentialProvider,
    label: row.label,
    baseUrl: row.baseUrl,
    enabled: row.enabled,
    keyPreview: preview,
    lastTestStatus: (row.lastTestStatus as ProviderCredentialPublic['lastTestStatus']) ?? null,
    lastTestMessage: row.lastTestMessage,
    lastTestedAt: row.lastTestedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const listProviderCredentials =
  (db: AgentsManageDatabaseClient) =>
  async (params: { scopes: ProjectScopeConfig }): Promise<ProviderCredentialPublic[]> => {
    const rows = await db
      .select()
      .from(providerCredentials)
      .where(projectScopedWhere(providerCredentials, params.scopes))
      .orderBy(desc(providerCredentials.createdAt));
    return rows.map(rowToPublic);
  };

export const getProviderCredential =
  (db: AgentsManageDatabaseClient) =>
  async (params: {
    scopes: ProjectScopeConfig;
    id: string;
  }): Promise<ProviderCredentialPublic | null> => {
    const [row] = await db
      .select()
      .from(providerCredentials)
      .where(
        and(
          projectScopedWhere(providerCredentials, params.scopes),
          eq(providerCredentials.id, params.id)
        )
      )
      .limit(1);
    return row ? rowToPublic(row) : null;
  };

export const getProviderCredentialDecrypted =
  (db: AgentsManageDatabaseClient) =>
  async (params: {
    scopes: ProjectScopeConfig;
    provider: ProviderCredentialProvider;
  }): Promise<{ apiKey: string; baseUrl: string | null } | null> => {
    const rows = await db
      .select()
      .from(providerCredentials)
      .where(
        and(
          projectScopedWhere(providerCredentials, params.scopes),
          eq(providerCredentials.provider, params.provider),
          eq(providerCredentials.enabled, true)
        )
      )
      .orderBy(desc(providerCredentials.updatedAt))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    try {
      const apiKey = decryptSecret({
        ciphertext: row.encryptedKey,
        iv: row.encryptionIv,
        authTag: row.authTag,
      });
      return { apiKey, baseUrl: row.baseUrl };
    } catch {
      return null;
    }
  };

export const listEnabledProvidersForProject =
  (db: AgentsManageDatabaseClient) =>
  async (params: { scopes: ProjectScopeConfig }): Promise<ProviderCredentialProvider[]> => {
    const rows = await db
      .select({ provider: providerCredentials.provider })
      .from(providerCredentials)
      .where(
        and(
          projectScopedWhere(providerCredentials, params.scopes),
          eq(providerCredentials.enabled, true)
        )
      );
    const unique = new Set(rows.map((r) => r.provider as ProviderCredentialProvider));
    return Array.from(unique);
  };

export const createProviderCredential =
  (db: AgentsManageDatabaseClient) =>
  async (params: {
    scopes: ProjectScopeConfig;
    id?: string;
    provider: ProviderCredentialProvider;
    label?: string;
    apiKey: string;
    baseUrl?: string;
    enabled?: boolean;
    createdBy?: string;
  }): Promise<ProviderCredentialPublic> => {
    const encrypted = encryptSecret(params.apiKey);
    const now = new Date().toISOString();
    const id = params.id ?? nanoid();

    const [row] = await db
      .insert(providerCredentials)
      .values({
        tenantId: params.scopes.tenantId,
        projectId: params.scopes.projectId,
        id,
        provider: params.provider,
        label: params.label ?? null,
        baseUrl: params.baseUrl ?? null,
        encryptedKey: encrypted.ciphertext,
        encryptionIv: encrypted.iv,
        authTag: encrypted.authTag,
        keyFingerprint: fingerprint(params.apiKey),
        enabled: params.enabled ?? true,
        createdBy: params.createdBy ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return rowToPublic(row);
  };

export const updateProviderCredential =
  (db: AgentsManageDatabaseClient) =>
  async (params: {
    scopes: ProjectScopeConfig;
    id: string;
    data: {
      label?: string;
      apiKey?: string;
      baseUrl?: string;
      enabled?: boolean;
    };
  }): Promise<ProviderCredentialPublic | null> => {
    const update: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };
    if (params.data.label !== undefined) update.label = params.data.label;
    if (params.data.baseUrl !== undefined) update.baseUrl = params.data.baseUrl;
    if (params.data.enabled !== undefined) update.enabled = params.data.enabled;
    if (params.data.apiKey !== undefined) {
      const encrypted = encryptSecret(params.data.apiKey);
      update.encryptedKey = encrypted.ciphertext;
      update.encryptionIv = encrypted.iv;
      update.authTag = encrypted.authTag;
      update.keyFingerprint = fingerprint(params.data.apiKey);
      update.lastTestStatus = null;
      update.lastTestMessage = null;
      update.lastTestedAt = null;
    }

    await db
      .update(providerCredentials)
      .set(update)
      .where(
        and(
          projectScopedWhere(providerCredentials, params.scopes),
          eq(providerCredentials.id, params.id)
        )
      );

    return await getProviderCredential(db)({ scopes: params.scopes, id: params.id });
  };

export const recordProviderCredentialTest =
  (db: AgentsManageDatabaseClient) =>
  async (params: {
    scopes: ProjectScopeConfig;
    id: string;
    status: 'success' | 'failure';
    message: string;
  }): Promise<void> => {
    await db
      .update(providerCredentials)
      .set({
        lastTestStatus: params.status,
        lastTestMessage: params.message,
        lastTestedAt: new Date().toISOString(),
      })
      .where(
        and(
          projectScopedWhere(providerCredentials, params.scopes),
          eq(providerCredentials.id, params.id)
        )
      );
  };

export const deleteProviderCredential =
  (db: AgentsManageDatabaseClient) =>
  async (params: { scopes: ProjectScopeConfig; id: string }): Promise<boolean> => {
    const existing = await getProviderCredential(db)(params);
    if (!existing) return false;
    await db
      .delete(providerCredentials)
      .where(
        and(
          projectScopedWhere(providerCredentials, params.scopes),
          eq(providerCredentials.id, params.id)
        )
      );
    return true;
  };

export { rowToPublic as providerCredentialRowToPublic };
