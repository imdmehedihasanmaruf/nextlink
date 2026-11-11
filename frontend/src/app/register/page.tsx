// New subscribers do not self-register here — the ISP validates the applicant,
// creates the billing profile and provisions the line. This page used to POST
// to a non-existent /api/auth/register endpoint (404 every time). It now
// explains the approved path and links to the live application flow.
'use client'

import React from 'react'
import { Wifi, CheckCircle2, ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/store/settingsStore'

const steps = [
  {
    title: 'Apply for a connection',
    detail: 'Tell us your address and the plan you want. A real person reviews the application.',
  },
  {
    title: 'Field team verifies coverage',
    detail: 'We confirm fibre reach at your address and schedule the drop.',
  },
  {
    title: 'Service is activated',
    detail: 'Your line is provisioned, your billing cycle starts and you sign in to the portal.',
  },
]

export default function RegisterPage() {
  useTranslation() // keep language state alive for the shell
  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 py-8 bg-gradient-to-br from-background via-muted/30 to-background">
      <div className="w-full max-w-lg space-y-6">
        <Link href="/login" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft size={16} />
          <span>Back to Login</span>
        </Link>

        <div className="text-center">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-primary text-primary-foreground mb-2 shadow-lg">
            <Wifi size={28} className="stroke-[2.5]" />
          </div>
          <h1 className="text-2xl md:text-3xl font-black tracking-tight">
            Become a NextLink Subscriber
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            New connections go through our install team — there is no self-service signup, because every line is provisioned on our network after verification.
          </p>
        </div>

        <Card className="border-2 shadow-xl bg-card">
          <CardContent className="p-6 space-y-4">
            <ol className="space-y-3">
              {steps.map((step, index) => (
                <li key={index} className="flex items-start gap-3">
                  <div className="mt-0.5 h-6 w-6 shrink-0 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">
                    {index + 1}
                  </div>
                  <div>
                    <p className="font-semibold text-sm">{step.title}</p>
                    <p className="text-xs text-muted-foreground">{step.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-700 dark:text-emerald-400 flex items-start gap-2">
              <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
              <span>Applications are usually processed within one working day. You get an SMS when the engineer is scheduled.</span>
            </div>
            <Link href="/apply" className="block">
              <Button className="w-full h-11 font-bold text-base shadow-md">
                Apply for a Connection
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

