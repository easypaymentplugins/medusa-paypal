import type { AuthorizePaymentInput, AuthorizePaymentOutput, CapturePaymentInput, CapturePaymentOutput, CancelPaymentInput, CancelPaymentOutput, GetPaymentStatusInput, GetPaymentStatusOutput, InitiatePaymentInput, InitiatePaymentOutput, RefundPaymentInput, RefundPaymentOutput, RetrievePaymentInput, RetrievePaymentOutput, UpdatePaymentInput, UpdatePaymentOutput } from "@medusajs/framework/types";
import { PayPalProviderBase } from "./base-provider";
declare class PayPalAdvancedCardProvider extends PayPalProviderBase {
    static identifier: string;
    protected readonly sessionPrefix = "pp_card";
    protected readonly idempotencyPrefix = "pp-card";
    initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput>;
    updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput>;
    authorizePayment(_input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput>;
    capturePayment(_input: CapturePaymentInput): Promise<CapturePaymentOutput>;
    cancelPayment(_input: CancelPaymentInput): Promise<CancelPaymentOutput>;
    refundPayment(_input: RefundPaymentInput): Promise<RefundPaymentOutput>;
    retrievePayment(_input: RetrievePaymentInput): Promise<RetrievePaymentOutput>;
    getPaymentStatus(_input: GetPaymentStatusInput): Promise<GetPaymentStatusOutput>;
}
export default PayPalAdvancedCardProvider;
export { PayPalAdvancedCardProvider };
//# sourceMappingURL=card-service.d.ts.map