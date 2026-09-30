// Who may view or administer a tenant (docs/plans/phase-10-client-os.md). Regenera owners administer every tenant;
// other Regenera staff can view; a client admin administers only their own organization; client users view their own.
import { isInternal, type UserScope } from "@/lib/db/scoped";
import { isMandateAdmin } from "@/lib/mandates";
import { REGENERA_TENANT_ID } from "./vocab";

export function canAdminTenant(scope: UserScope, tenantId: string) {
  if (isInternal(scope) && isMandateAdmin(scope)) return true;
  return (scope.adminOf ?? []).includes(tenantId);
}

export function canViewTenant(scope: UserScope, tenantId: string) {
  return isInternal(scope) || (scope.tenantIds ?? []).includes(tenantId);
}

/** Only Regenera owners change entitlements, plans, seats and account status: those are contract terms. */
export const canSetEntitlements = (scope: UserScope) => isInternal(scope) && isMandateAdmin(scope);

/** The tenant a page should show: the requested one if visible, else the user's first administered or member tenant. */
export function pickTenant(scope: UserScope, requested: string | undefined) {
  if (requested && canViewTenant(scope, requested)) return requested;
  return scope.adminOf?.[0] ?? scope.tenantIds?.[0] ?? REGENERA_TENANT_ID;
}
