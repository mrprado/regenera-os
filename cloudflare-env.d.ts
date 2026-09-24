declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    // Comma-separated emails allowed to sign in until mandate_members exists (phase 0 bootstrap).
    OS_ALLOWLIST?: string;
    JOBS_TICK_TOKEN?: string;
    ANTHROPIC_API_KEY?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    TOKEN_ENCRYPTION_KEY?: string;
    APOLLO_API_KEY?: string;
    APOLLO_MONTHLY_CREDIT_BUDGET?: string;
    AI_MONTHLY_BUDGET_USD?: string;
    ESRI_API_KEY?: string;
    APP_ENV?: string;
    SEND_ALLOWED_DOMAINS?: string;
    RESEND_API_KEY?: string;
    RESEND_FROM?: string;
    NOTIFY_EMAIL?: string;
    SITE_WEBHOOK_SECRET?: string;
    SITE_EXPORT_TOKEN?: string;
    SITE_BASE_URL?: string;
    EXTENSION_TOKEN_SECRET?: string;
    UNSUBSCRIBE_SIGNING_SECRET?: string;
    APP_BASE_URL?: string;
    BOOKING_URL?: string;
    COMPANY_POSTAL_ADDRESS?: string;
  }
}
