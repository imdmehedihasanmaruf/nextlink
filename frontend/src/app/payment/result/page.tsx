'use client'

import React, { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { PaymentResultScreen, PaymentStatusType } from '@/components/PaymentResultScreen'
import { RefreshCw } from 'lucide-react'

function PaymentResultInner() {
  const searchParams = useSearchParams()
  const rawStatus = (searchParams.get('status') || 'success').toLowerCase()

  let normalizedStatus: PaymentStatusType = 'success'
  if (rawStatus === 'failed' || rawStatus === 'fail' || rawStatus === 'error') {
    normalizedStatus = 'failed'
  } else if (rawStatus === 'cancelled' || rawStatus === 'cancel') {
    normalizedStatus = 'cancelled'
  } else if (rawStatus === 'pending') {
    normalizedStatus = 'pending'
  } else if (rawStatus === 'verifying' || rawStatus === 'verification') {
    normalizedStatus = 'verifying'
  }

  const invoiceId = searchParams.get('invoiceId') || searchParams.get('invoice_id') || searchParams.get('paid')
  const transactionId = searchParams.get('transactionId') || searchParams.get('trxId') || searchParams.get('trx_id')
  const gateway = searchParams.get('gateway') || searchParams.get('method')
  const amount = searchParams.get('amount')
  const errorMessage = searchParams.get('error') || searchParams.get('message')

  return (
    <PaymentResultScreen
      initialStatus={normalizedStatus}
      invoiceId={invoiceId}
      transactionId={transactionId}
      gateway={gateway}
      amount={amount}
      errorMessage={errorMessage}
    />
  )
}

export default function PaymentResultPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[60vh] flex items-center justify-center">
          <RefreshCw className="h-6 w-6 animate-spin text-primary" />
        </div>
      }
    >
      <PaymentResultInner />
    </Suspense>
  )
}

