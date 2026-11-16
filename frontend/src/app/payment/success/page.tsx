'use client'

import React, { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { PaymentResultScreen } from '@/components/PaymentResultScreen'
import { RefreshCw } from 'lucide-react'

function SuccessInner() {
  const searchParams = useSearchParams()
  const invoiceId = searchParams.get('invoiceId') || searchParams.get('invoice_id') || searchParams.get('paid')
  const transactionId = searchParams.get('transactionId') || searchParams.get('trxId') || searchParams.get('trx_id')
  const gateway = searchParams.get('gateway') || searchParams.get('method')
  const amount = searchParams.get('amount')

  return (
    <PaymentResultScreen
      initialStatus="success"
      invoiceId={invoiceId}
      transactionId={transactionId}
      gateway={gateway}
      amount={amount}
    />
  )
}

export default function PaymentSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[60vh] flex items-center justify-center">
          <RefreshCw className="h-6 w-6 animate-spin text-primary" />
        </div>
      }
    >
      <SuccessInner />
    </Suspense>
  )
}

