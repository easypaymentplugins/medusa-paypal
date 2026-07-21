type Environment = "sandbox" | "live";
type Status = "disconnected" | "pending" | "pending_credentials" | "connected" | "revoked";
declare const PayPalModuleService_base: import("@medusajs/framework/utils").MedusaServiceReturnType<import("@medusajs/framework/utils").ModelConfigurationsToConfigTemplate<{
    readonly PayPalConnection: import("@medusajs/framework/utils").DmlEntity<import("@medusajs/framework/utils").DMLEntitySchemaBuilder<{
        id: import("@medusajs/framework/utils").PrimaryKeyModifier<string, import("@medusajs/framework/utils").IdProperty>;
        environment: import("@medusajs/framework/utils").TextProperty;
        status: import("@medusajs/framework/utils").TextProperty;
        shared_id: import("@medusajs/framework/utils").NullableModifier<string, import("@medusajs/framework/utils").TextProperty>;
        auth_code: import("@medusajs/framework/utils").NullableModifier<string, import("@medusajs/framework/utils").TextProperty>;
        seller_client_id: import("@medusajs/framework/utils").NullableModifier<string, import("@medusajs/framework/utils").TextProperty>;
        seller_client_secret: import("@medusajs/framework/utils").NullableModifier<string, import("@medusajs/framework/utils").TextProperty>;
        seller_merchant_id: import("@medusajs/framework/utils").NullableModifier<string, import("@medusajs/framework/utils").TextProperty>;
        seller_email: import("@medusajs/framework/utils").NullableModifier<string, import("@medusajs/framework/utils").TextProperty>;
        app_access_token: import("@medusajs/framework/utils").NullableModifier<string, import("@medusajs/framework/utils").TextProperty>;
        app_access_token_expires_at: import("@medusajs/framework/utils").NullableModifier<Date, import("@medusajs/framework/utils").DateTimeProperty>;
        metadata: import("@medusajs/framework/utils").JSONProperty;
    }>, "paypal_connection">;
    readonly PayPalMetric: import("@medusajs/framework/utils").DmlEntity<import("@medusajs/framework/utils").DMLEntitySchemaBuilder<{
        id: import("@medusajs/framework/utils").PrimaryKeyModifier<string, import("@medusajs/framework/utils").IdProperty>;
        name: import("@medusajs/framework/utils").TextProperty;
        data: import("@medusajs/framework/utils").JSONProperty;
    }>, "paypal_metric">;
    readonly PayPalSettings: import("@medusajs/framework/utils").DmlEntity<import("@medusajs/framework/utils").DMLEntitySchemaBuilder<{
        id: import("@medusajs/framework/utils").PrimaryKeyModifier<string, import("@medusajs/framework/utils").IdProperty>;
        data: import("@medusajs/framework/utils").NullableModifier<Record<string, unknown>, import("@medusajs/framework/utils").JSONProperty>;
    }>, "paypal_settings">;
    readonly PayPalWebhookEvent: import("@medusajs/framework/utils").DmlEntity<import("@medusajs/framework/utils").DMLEntitySchemaBuilder<{
        id: import("@medusajs/framework/utils").PrimaryKeyModifier<string, import("@medusajs/framework/utils").IdProperty>;
        event_id: import("@medusajs/framework/utils").TextProperty;
        event_type: import("@medusajs/framework/utils").TextProperty;
        event_version: import("@medusajs/framework/utils").NullableModifier<string, import("@medusajs/framework/utils").TextProperty>;
        transmission_id: import("@medusajs/framework/utils").NullableModifier<string, import("@medusajs/framework/utils").TextProperty>;
        transmission_time: import("@medusajs/framework/utils").NullableModifier<Date, import("@medusajs/framework/utils").DateTimeProperty>;
        status: import("@medusajs/framework/utils").TextProperty;
        attempt_count: import("@medusajs/framework/utils").NumberProperty;
        next_retry_at: import("@medusajs/framework/utils").NullableModifier<Date, import("@medusajs/framework/utils").DateTimeProperty>;
        processed_at: import("@medusajs/framework/utils").NullableModifier<Date, import("@medusajs/framework/utils").DateTimeProperty>;
        last_error: import("@medusajs/framework/utils").NullableModifier<string, import("@medusajs/framework/utils").TextProperty>;
        resource_id: import("@medusajs/framework/utils").NullableModifier<string, import("@medusajs/framework/utils").TextProperty>;
        payload: import("@medusajs/framework/utils").JSONProperty;
    }>, "paypal_webhook_event">;
}>>;
declare class PayPalModuleService extends PayPalModuleService_base {
    protected cfg: import("./types/config").PayPalModuleConfig;
    private tokenRefreshPromise;
    private get bnCode();
    private getSettingsData;
    private ensureSettingsDefaults;
    getApiDetails(): Promise<{
        onboarding: Record<string, any>;
        apiDetails: Record<string, any>;
    }>;
    private getAlertWebhookUrls;
    private getPartnerMerchantId;
    private getCurrentRow;
    private getCurrentEnvironment;
    private getEnvCreds;
    private extractSellerEmail;
    private fetchMerchantIntegrationDetails;
    private getAppAccessTokenForCredentials;
    private fetchSellerProfileFromDirectCredentials;
    private hydrateSellerMetadataFromCredentials;
    private syncRowFieldsFromMetadata;
    setEnvironment(env: Environment): Promise<any>;
    createOnboardingLink(input?: {
        email?: string;
        products?: string[];
        env?: Environment;
    }): Promise<{
        onboarding_url: string;
        return_url: string;
    }>;
    startOnboarding(): Promise<void>;
    saveOnboardCallback(input: {
        authCode: string;
        sharedId: string;
    }): Promise<{
        id: string;
        environment: string;
        status: string;
        shared_id: string | null;
        auth_code: string | null;
        seller_client_id: string | null;
        seller_client_secret: string | null;
        seller_merchant_id: string | null;
        seller_email: string | null;
        app_access_token: string | null;
        app_access_token_expires_at: Date | null;
        metadata: Record<string, unknown>;
        created_at: Date;
        updated_at: Date;
        deleted_at: Date | null;
    }>;
    exchangeAndSaveSellerCredentials(input: {
        authCode: string;
        sharedId: string;
        env?: "sandbox" | "live";
    }): Promise<void>;
    saveSellerCredentials(input: {
        clientId: string;
        clientSecret: string;
        sellerMerchantId?: string | null;
        sellerEmail?: string | null;
        environment?: Environment;
    }): Promise<{
        id: string;
        environment: string;
        status: string;
        shared_id: string | null;
        auth_code: string | null;
        seller_client_id: string | null;
        seller_client_secret: string | null;
        seller_merchant_id: string | null;
        seller_email: string | null;
        app_access_token: string | null;
        app_access_token_expires_at: Date | null;
        metadata: Record<string, unknown>;
        created_at: Date;
        updated_at: Date;
        deleted_at: Date | null;
    }>;
    saveAndHydrateSellerCredentials(input: {
        clientId: string;
        clientSecret: string;
        environment?: Environment;
    }): Promise<{
        environment: Environment;
        status: Status;
        seller_client_id_present: boolean;
        shared_id?: undefined;
        auth_code?: undefined;
        seller_client_id_masked?: undefined;
        seller_client_secret_masked?: undefined;
        seller_merchant_id?: undefined;
        seller_email?: undefined;
        updated_at?: undefined;
    } | {
        environment: Environment;
        status: Status;
        shared_id: any;
        auth_code: string | null;
        seller_client_id_present: boolean;
        seller_client_id_masked: string | null;
        seller_client_secret_masked: string | null;
        seller_merchant_id: string | null;
        seller_email: string | null;
        updated_at: any;
    }>;
    private resolveWebhookUrl;
    /** Legacy webhook path (blocked by Medusa's store publishable-key guard). */
    private resolveLegacyWebhookUrl;
    private isLocalWebhookUrl;
    private webhookUrlMigrationChecked;
    private webhookHealScheduled;
    private migrateLegacyWebhookUrl;
    private ensureWebhookRegistration;
    private maskValue;
    /**
     * Report the current connection status.
     *
     * `hydrateMissingProfile` is opt-in and OFF by default: status is read on
     * `GET /admin/paypal/status` (and other read-only routes), where it must be a
     * safe, side-effect-free read. The seller-profile backfill makes an outbound
     * PayPal call and persists to the DB, so it only runs from write contexts
     * (e.g. saving credentials) that explicitly request it.
     */
    getStatus(envOverride?: Environment, opts?: {
        hydrateMissingProfile?: boolean;
    }): Promise<{
        environment: Environment;
        status: Status;
        seller_client_id_present: boolean;
        shared_id?: undefined;
        auth_code?: undefined;
        seller_client_id_masked?: undefined;
        seller_client_secret_masked?: undefined;
        seller_merchant_id?: undefined;
        seller_email?: undefined;
        updated_at?: undefined;
    } | {
        environment: Environment;
        status: Status;
        shared_id: any;
        auth_code: string | null;
        seller_client_id_present: boolean;
        seller_client_id_masked: string | null;
        seller_client_secret_masked: string | null;
        seller_merchant_id: string | null;
        seller_email: string | null;
        updated_at: any;
    }>;
    disconnect(): Promise<void>;
    getAppAccessToken(): Promise<string>;
    private refreshAccessToken;
    generateClientToken(opts?: {
        locale?: string;
    }): Promise<string>;
    getSettings(): Promise<{
        data: Record<string, any>;
    }>;
    private deepMerge;
    saveSettings(patch: Record<string, any>): Promise<{
        data: Record<string, any>;
    }>;
    getActiveCredentials(): Promise<{
        environment: Environment;
        client_id: string;
        client_secret: string;
    }>;
    getOrderDetails(orderId: string): Promise<any>;
    createWebhookEventRecord(input: {
        event_id: string;
        event_type: string;
        resource_id?: string | null;
        payload?: Record<string, unknown>;
        event_version?: string | null;
        transmission_id?: string | null;
        transmission_time?: Date | null;
        status?: string;
        attempt_count?: number;
    }): Promise<{
        created: boolean;
        event: {
            id: string;
            event_id: string;
            event_type: string;
            event_version: string | null;
            transmission_id: string | null;
            transmission_time: Date | null;
            status: string;
            attempt_count: number;
            next_retry_at: Date | null;
            processed_at: Date | null;
            last_error: string | null;
            resource_id: string | null;
            payload: Record<string, unknown>;
            created_at: Date;
            updated_at: Date;
            deleted_at: Date | null;
        };
    }>;
    updateWebhookEventRecord(input: {
        id: string;
        status?: string;
        attempt_count?: number;
        next_retry_at?: Date | null;
        processed_at?: Date | null;
        last_error?: string | null;
        resource_id?: string | null;
    }): Promise<{
        id: string;
        event_id: string;
        event_type: string;
        event_version: string | null;
        transmission_id: string | null;
        transmission_time: Date | null;
        status: string;
        attempt_count: number;
        next_retry_at: Date | null;
        processed_at: Date | null;
        last_error: string | null;
        resource_id: string | null;
        payload: Record<string, unknown>;
        created_at: Date;
        updated_at: Date;
        deleted_at: Date | null;
    }>;
    /**
     * Emit an audit event as a single structured log line.
     *
     * The dedicated audit-log table was removed; for high-volume/containerized
     * deployments the audit trail lives in aggregated stdout logs. This records a
     * greppable `paypal_audit` line (filter on `"log":"paypal_audit"`) with
     * sensitive keys redacted. It never throws — audit logging must not break the
     * caller's payment flow.
     */
    recordAuditEvent(eventType: string, metadata?: Record<string, unknown>): Promise<null>;
    recordMetric(name: string, metadata?: Record<string, unknown>): Promise<{
        id: string;
        name: string;
        data: Record<string, unknown>;
        created_at: Date;
        updated_at: Date;
        deleted_at: Date | null;
    } | null>;
    recordPaymentLog(eventType: string, metadata?: Record<string, unknown>): Promise<null>;
    sendAlert(input: {
        type: string;
        message: string;
        metadata?: Record<string, unknown>;
    }): Promise<void>;
}
export default PayPalModuleService;
//# sourceMappingURL=service.d.ts.map