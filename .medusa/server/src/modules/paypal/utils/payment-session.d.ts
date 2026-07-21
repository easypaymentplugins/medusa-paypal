/**
 * Shared PayPal payment-session helpers.
 *
 * `create-order` and `capture-order` must agree on (a) which payment session
 * belongs to a cart and (b) how the PayPal order id is stored/read on it —
 * otherwise the capture's fail-closed binding (the order id stored by
 * create-order must equal the one being captured) can never be satisfied.
 * Keeping the logic here, resolved through the Payment module service
 * (`Modules.PAYMENT`), guarantees both routes use the same, correct path.
 */
export type PayPalCartSession = {
    session_id: string;
    session_data: Record<string, any>;
    session_status: string;
};
/**
 * Resolve the cart's active PayPal payment session (wallet or card). When a
 * cart has more than one PayPal session, the most recently created one wins —
 * both create-order and capture-order rely on this same selection so they
 * always read and write the same session.
 */
export declare function findPayPalSessionForCart(cartId: string, scope: any): Promise<PayPalCartSession | null>;
/**
 * Read the PayPal order id stored on a session's `data`. Accepts both the
 * canonical `data.paypal.order_id` and the legacy top-level `data.order_id`.
 * Returns null when none is present.
 */
export declare function getStoredPayPalOrderId(sessionData?: Record<string, any> | null): string | null;
export declare function updatePayPalSessionData(sessionId: string, extraData: Record<string, any>, scope: any): Promise<void>;
//# sourceMappingURL=payment-session.d.ts.map