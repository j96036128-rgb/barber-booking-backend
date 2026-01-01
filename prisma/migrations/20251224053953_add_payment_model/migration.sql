-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('REQUIRES_PAYMENT', 'PAID', 'REFUNDED', 'FAILED');

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "stripePaymentIntentId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'REQUIRES_PAYMENT',
    "customerId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Payment_stripePaymentIntentId_key" ON "Payment"("stripePaymentIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_appointmentId_key" ON "Payment"("appointmentId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
