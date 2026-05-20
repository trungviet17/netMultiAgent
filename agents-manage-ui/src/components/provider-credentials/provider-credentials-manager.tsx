'use client';

import { CheckCircle2, Plus, RefreshCw, Trash2, XCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  createProviderCredential,
  deleteProviderCredential,
  type ProviderCredential,
  type ProviderCredentialProvider,
  testProviderCredential,
  testStoredProviderCredential,
  updateProviderCredential,
} from '@/lib/api/provider-credentials';

type Props = {
  tenantId: string;
  projectId: string;
  initial: ProviderCredential[];
  canEdit: boolean;
};

const PROVIDER_OPTIONS: { value: ProviderCredentialProvider; label: string }[] = [
  { value: 'anthropic', label: 'Anthropic (Claude)' },
  { value: 'openai', label: 'OpenAI (GPT)' },
  { value: 'google', label: 'Google (Gemini)' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'custom', label: 'Custom (OpenAI-compatible)' },
];

export function ProviderCredentialsManager({ tenantId, projectId, initial, canEdit }: Props) {
  const router = useRouter();
  const [credentials, setCredentials] = useState<ProviderCredential[]>(initial);
  const [showForm, setShowForm] = useState(false);
  const [provider, setProvider] = useState<ProviderCredentialProvider>('openai');
  const [apiKey, setApiKey] = useState('');
  const [label, setLabel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [busy, startTransition] = useTransition();
  const [testing, setTesting] = useState(false);

  const resetForm = () => {
    setApiKey('');
    setLabel('');
    setBaseUrl('');
    setProvider('openai');
    setShowForm(false);
  };

  const onTestInline = async () => {
    if (!apiKey) {
      toast.error('Enter an API key first');
      return;
    }
    if (provider === 'custom' && !baseUrl) {
      toast.error('Enter a baseUrl for custom providers');
      return;
    }
    setTesting(true);
    try {
      const res = await testProviderCredential(tenantId, projectId, {
        provider,
        apiKey,
        baseUrl: provider === 'custom' ? baseUrl : undefined,
      });
      if (res.success) toast.success(res.message);
      else toast.error(res.message);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey) {
      toast.error('API key is required');
      return;
    }
    if (provider === 'custom' && !baseUrl) {
      toast.error('baseUrl is required for custom providers');
      return;
    }
    startTransition(async () => {
      try {
        // Test before save so users get clear feedback.
        const test = await testProviderCredential(tenantId, projectId, {
          provider,
          apiKey,
          baseUrl: provider === 'custom' ? baseUrl : undefined,
        });
        if (!test.success) {
          toast.error(`Connection test failed: ${test.message}`);
          return;
        }

        const created = await createProviderCredential(tenantId, projectId, {
          provider,
          apiKey,
          label: label || undefined,
          baseUrl: provider === 'custom' ? baseUrl : undefined,
        });
        setCredentials((prev) => [created, ...prev]);
        toast.success('Provider credential saved');
        resetForm();
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  };

  const onToggleEnabled = async (cred: ProviderCredential, enabled: boolean) => {
    try {
      const updated = await updateProviderCredential(tenantId, projectId, cred.id, { enabled });
      setCredentials((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const onDelete = async (cred: ProviderCredential) => {
    if (!confirm(`Delete ${cred.provider} credential?`)) return;
    try {
      await deleteProviderCredential(tenantId, projectId, cred.id);
      setCredentials((prev) => prev.filter((c) => c.id !== cred.id));
      toast.success('Deleted');
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const onTestStored = async (cred: ProviderCredential) => {
    try {
      const res = await testStoredProviderCredential(tenantId, projectId, cred.id);
      if (res.success) toast.success(res.message);
      else toast.error(res.message);
      // refresh to show new lastTestStatus
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {canEdit && !showForm && (
        <div>
          <Button onClick={() => setShowForm(true)}>
            <Plus className="size-4 mr-1" />
            Add provider credential
          </Button>
        </div>
      )}

      {canEdit && showForm && (
        <form onSubmit={onSubmit} className="border rounded-lg p-4 flex flex-col gap-3 bg-card">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="provider">Provider</Label>
              <Select
                value={provider}
                onValueChange={(v) => setProvider(v as ProviderCredentialProvider)}
              >
                <SelectTrigger id="provider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDER_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="label">Label (optional)</Label>
              <Input
                id="label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Team OpenAI"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="apiKey">API Key</Label>
            <Input
              id="apiKey"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-…"
              autoComplete="off"
            />
          </div>

          {provider === 'custom' && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="baseUrl">Base URL</Label>
              <Input
                id="baseUrl"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://your-endpoint.example.com/v1"
              />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 mt-1">
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Test & save'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={onTestInline}
              disabled={testing || busy}
            >
              {testing ? 'Testing…' : 'Test connection'}
            </Button>
            <Button type="button" variant="ghost" onClick={resetForm} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      <div className="flex flex-col gap-2">
        {credentials.length === 0 && (
          <div className="text-sm text-muted-foreground">
            No provider credentials yet. Add one to enable that provider's models in this project.
          </div>
        )}
        {credentials.map((cred) => (
          <div
            key={cred.id}
            className="border rounded-lg p-3 flex flex-wrap items-center gap-4 bg-card"
          >
            <div className="flex flex-col">
              <div className="font-medium text-sm flex items-center gap-2">
                {PROVIDER_OPTIONS.find((o) => o.value === cred.provider)?.label ?? cred.provider}
                {cred.label && <span className="text-muted-foreground">— {cred.label}</span>}
              </div>
              <div className="text-xs text-muted-foreground font-mono">
                {cred.keyPreview}
                {cred.baseUrl ? ` • ${cred.baseUrl}` : ''}
              </div>
              {cred.lastTestStatus && (
                <div className="text-xs flex items-center gap-1 mt-1">
                  {cred.lastTestStatus === 'success' ? (
                    <CheckCircle2 className="size-3 text-green-600" />
                  ) : (
                    <XCircle className="size-3 text-destructive" />
                  )}
                  <span className="text-muted-foreground">
                    {cred.lastTestMessage}{' '}
                    {cred.lastTestedAt ? `· ${new Date(cred.lastTestedAt).toLocaleString()}` : ''}
                  </span>
                </div>
              )}
            </div>
            <div className="ml-auto flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Label htmlFor={`enabled-${cred.id}`} className="text-xs">
                  Enabled
                </Label>
                <Switch
                  id={`enabled-${cred.id}`}
                  checked={cred.enabled}
                  onCheckedChange={(v) => onToggleEnabled(cred, v)}
                  disabled={!canEdit}
                />
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => onTestStored(cred)}
                disabled={!canEdit}
                title="Test stored key"
              >
                <RefreshCw className="size-3" />
              </Button>
              {canEdit && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => onDelete(cred)}
                  title="Delete"
                >
                  <Trash2 className="size-3" />
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
