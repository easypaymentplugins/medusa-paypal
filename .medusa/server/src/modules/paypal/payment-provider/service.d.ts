import type { AuthorizePaymentInput, AuthorizePaymentOutput, CapturePaymentInput, CapturePaymentOutput, CancelPaymentInput, CancelPaymentOutput, GetPaymentStatusInput, GetPaymentStatusOutput, InitiatePaymentInput, InitiatePaymentOutput, RefundPaymentInput, RefundPaymentOutput, RetrievePaymentInput, RetrievePaymentOutput, UpdatePaymentInput, UpdatePaymentOutput } from "@medusajs/framework/types";
import { PayPalProviderBase } from "./base-provider";
declare class PayPalPaymentProvider extends PayPalProviderBase {
    static identifier: string;
    protected readonly sessionPrefix = "pp";
    protected readonly idempotencyPrefix = "pp";
    private serializeError;
    private recordFailure;
    private recordSuccess;
    private recordPaymentEvent;
    initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput>;
    updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput>;
    authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput>;
    retrievePayment(input: RetrievePaymentInput): Promise<RetrievePaymentOutput>;
    getPaymentStatus(input: GetPaymentStatusInput): Promise<GetPaymentStatusOutput>;
    capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput>;
    refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput>;
    cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput>;
}
export default PayPalPaymentProvider;
export { PayPalPaymentProvider };
//# sourceMappingURL=service.d.ts.map