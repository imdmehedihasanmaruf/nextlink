'use client'

import React, { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { PaymentResultScreen } from '@/components/PaymentResultScreen'
import { RefreshCw } from 'lucide-react'

function CancelPortalInner() {
  const searchParams = useSearchParams()
  const invoiceId = searchParams.get('invoiceId') || searchParams.get('invoice_id')
  const transactionId = searchParams.get('transactionId') || searchParams.get('trxId')
  const gateway = searchParams.get('gateway')

  return (
    <PaymentResultScreen
      initialStatus="cancelled"
      invoiceId={invoiceId}
      transactionId={transactionId}
      gateway={gateway}
    />
  )
}

export default function PortalPaymentCancelPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[60vh] flex items-center justify-center">
          <RefreshCw className="h-6 w-6 animate-spin text-primary" />
        </div>
      }
    >
      <CancelPortalInner />
    </Suspense>
  )
}

