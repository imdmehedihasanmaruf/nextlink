'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { PlusCircle, MessageSquare, AlertCircle, CheckCircle, Clock, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/select'
import { useTranslation, useSettingsStore } from '@/store/settingsStore'
import { useAuthStore } from '@/store/authStore'
import { createTicket, fetchMyTickets, type PortalTicket } from '@/lib/portalApi'

interface Ticket {
  id: string
  subject: string
  category: string
  priority: 'low' | 'medium' | 'high' | 'critical'
  status: 'Open' | 'In Progress' | 'Resolved'
  createdAt: string
  lastUpdate: string
  description: string
}

const initialTickets: Ticket[] = []

export default function TicketsPage() {
  const router = useRouter()
  const { isAuthenticated, hasHydrated, user } = useAuthStore()
  const { t, language } = useTranslation()
  const autoSave = useSettingsStore((s) => s.autoSave)

  const [tickets, setTickets] = useState<Ticket[]>(initialTickets)
  const [showForm, setShowForm] = useState(false)
  const [subject, setSubject] = useState('')
  // The initial category must be one of the options — the previous value,
  // 'Connection Issue', matched none of them, so the browser posted an
  // invalid category and the CRM routing never matched.
  const TICKET_CATEGORIES = [
    'Fiber / Optical Issue',
    'Slow Speed',
    'Billing & Plan',
    'Configuration',
    'Other',
  ]
  const categoryOrDefault = (value: any) =>
    TICKET_CATEGORIES.includes(String(value)) ? String(value) : TICKET_CATEGORIES[0]

  const [category, setCategory] = useState(TICKET_CATEGORIES[0])
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'critical'>('medium')
  const [description, setDescription] = useState('')
  const [submittedMessage, setSubmittedMessage] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [loading, setLoading] = useState(false)

  /**
   * Map a ticket from the API into the shape the page renders.
   */
  const toTicket = (row: PortalTicket): Ticket => {
    const status = (row.status || 'open').toLowerCase()
    return {
      id: row.id,
      subject: row.title || row.subject || 'Support request',
      category: row.category || 'General',
      priority: (row.priority || 'medium') as Ticket['priority'],
      status:
        status === 'resolved' || status === 'closed'
          ? 'Resolved'
          : status === 'in_progress'
            ? 'In Progress'
            : 'Open',
      createdAt: new Date(row.created_at).toLocaleString(),
      lastUpdate: row.assigned_to_name
        ? `Assigned to ${row.assigned_to_name}`
        : 'Awaiting Helpdesk assignment',
      description: row.description || '',
    }
  }

  /**
   * Load the signed-in subscriber's tickets from the API.
   */
  const loadTickets = React.useCallback(async () => {
    if (!isAuthenticated) return
    setLoading(true)
    const result = await fetchMyTickets()
    setLoading(false)
    if (result.success && Array.isArray(result.tickets)) {
      setTickets(result.tickets.map(toTicket))
    }
  }, [isAuthenticated])

  useEffect(() => {
    if (hasHydrated && isAuthenticated) {
      loadTickets()
    }
  }, [hasHydrated, isAuthenticated, loadTickets])

  // Auto-save load
  useEffect(() => {
    if (autoSave) {
      const saved = localStorage.getItem('draft_ticket')
      if (saved) {
        try {
          const parsed = JSON.parse(saved)
          setSubject(parsed.subject || '')
          setCategory(categoryOrDefault(parsed.category))
          setPriority(parsed.priority || 'medium')
          setDescription(parsed.description || '')
        } catch (e) {}
      }
    }
  }, [autoSave])

  // Auto-save store
  useEffect(() => {
    if (autoSave) {
      localStorage.setItem('draft_ticket', JSON.stringify({ subject, category, priority, description }))
    }
  }, [subject, category, priority, description, autoSave])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    // If user is not authenticated, redirect to login page before submitting ticket
    if (!isAuthenticated) {
      router.push('/login?redirect=tickets')
      return
    }
    if (!subject.trim() || !description.trim()) {
      setSubmitError(
        language === 'bn'
          ? 'বিষয় এবং বিবরণ দুটিই পূরণ করুন।'
          : 'Please fill in both the subject and the description.'
      )
      return
    }

    setSubmitError('')
    setIsSubmitting(true)

    const result = await createTicket({
      subject: subject.trim(),
      category,
      priority,
      description: description.trim(),
    })

    setIsSubmitting(false)

    if (!result.success) {
      setSubmitError(result.error || 'We could not submit your ticket. Please try again.')
      return
    }

    setSubject('')
    setDescription('')
    if (autoSave) {
      localStorage.removeItem('draft_ticket')
    }
    setShowForm(false)
    setSubmittedMessage(language === 'bn' ? 'আপনার টিকিট সফলভাবে জমা হয়েছে!' : 'Your support ticket has been submitted!')
    setTimeout(() => setSubmittedMessage(''), 4000)

    // Reload the list so the ticket appears with its real id and assignment.
    loadTickets()
  }

  const getPriorityBadge = (p: string) => {
    switch (p) {
      case 'critical':
      case 'high':
        return <Badge className="bg-red-500 text-white hover:bg-red-600">High</Badge>
      case 'medium':
        return <Badge className="bg-amber-500 text-white hover:bg-amber-600">Medium</Badge>
      default:
        return <Badge variant="secondary">Low</Badge>
    }
  }

  const getStatusBadge = (s: string) => {
    switch (s) {
      case 'Open':
        return <Badge className="bg-blue-500 text-white">Open</Badge>
      case 'In Progress':
        return <Badge className="bg-purple-500 text-white">In Progress</Badge>
      case 'Resolved':
        return <Badge className="bg-green-600 text-white">Resolved</Badge>
      default:
        return <Badge variant="outline">{s}</Badge>
    }
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl space-y-8">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">
            {language === 'bn' ? 'গ্রাহক সহায়তা ও অভিযোগ ডায়েরি' : 'Helpdesk & Support Tickets'}
          </h1>
          <p className="text-muted-foreground mt-1">
            {language === 'bn' 
              ? 'ইন্টারনেট সমস্যা বা সার্ভিসের জন্য সরাসরি টেকনিক্যাল টিমের সাথে যোগাযোগ করুন।' 
              : 'Direct CRM ticket routing to regional field technicians with SLA tracking.'}
          </p>
        </div>
        <Button onClick={() => {
          if (!isAuthenticated) {
            router.push('/login?redirect=tickets')
            return
          }
          setShowForm(!showForm)
        }} className="gap-2">
          <PlusCircle className="h-4 w-4" />
          {showForm 
            ? (language === 'bn' ? 'ফর্ম বন্ধ করুন' : 'Cancel') 
            : (language === 'bn' ? 'নতুন টিকিট খুলুন' : 'New Ticket')}
        </Button>
      </div>

      {submittedMessage && (
        <div className="rounded-xl border border-green-500/50 bg-green-500/10 p-4 text-green-600 dark:text-green-400 flex items-center gap-2">
          <CheckCircle className="h-5 w-5" />
          <span>{submittedMessage}</span>
        </div>
      )}

      {/* Ticket Create Form */}
      {showForm && (
        <Card className="border shadow-md animate-in fade-in slide-in-from-top-4 duration-300">
          <CardHeader>
            <CardTitle>{language === 'bn' ? 'নতুন সাপোর্ট টিকিট তৈরি করুন' : 'Submit Support Ticket'}</CardTitle>
            <CardDescription>
              {autoSave && (
                <span className="text-xs text-primary font-medium">
                  {language === 'bn' ? '✓ অটো সেভ চালু আছে' : '✓ Auto Save enabled (draft saved locally)'}
                </span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="subject">{language === 'bn' ? 'বিষয় / শিরোনাম' : 'Subject / Issue Title'}</Label>
                <Input 
                  id="subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder={language === 'bn' ? 'যেমন: ইন্টারনেটের স্পিড ধীরগতি' : 'e.g. Internet disconnected or red light on router'}
                  required
                  className="mt-1"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="category">{language === 'bn' ? 'ক্যাটাগরি' : 'Category'}</Label>
                  <Select id="category" value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1">
                    <option value="Fiber / Optical Issue">Fiber / Optical Issue (LOS)</option>
                    <option value="Slow Speed">Slow Speed / Latency</option>
                    <option value="Billing & Plan">Billing / Payment Query</option>
                    <option value="Configuration">Router / Wi-Fi Setup</option>
                    <option value="Other">Other Query</option>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="priority">{language === 'bn' ? 'অগ্রাধিকার (Priority)' : 'Priority'}</Label>
                  <Select id="priority" value={priority} onChange={(e) => setPriority(e.target.value as any)} className="mt-1">
                    <option value="low">Low (General Query)</option>
                    <option value="medium">Medium (Standard)</option>
                    <option value="high">High (No Internet / Work Impact)</option>
                    <option value="critical">Critical (Line Cut / Fiber Broken)</option>
                  </Select>
                </div>
              </div>

              <div>
                <Label htmlFor="description">{language === 'bn' ? 'বিস্তারিত বিবরণ' : 'Detailed Description'}</Label>
                <Textarea 
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  placeholder={language === 'bn' ? 'আপনার সমস্যার বিস্তারিত তথ্য দিন...' : 'Describe what happened, any error lights, or affected devices...'}
                  required
                  className="mt-1"
                />
              </div>

              {submitError && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  {submitError}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                  {language === 'bn' ? 'বাতিল' : 'Cancel'}
                </Button>
                <Button type="submit" className="gap-2" disabled={isSubmitting}>
                  <Send className="h-4 w-4" />
                  {isSubmitting
                    ? language === 'bn' ? 'পাঠানো হচ্ছে...' : 'Submitting...'
                    : language === 'bn' ? 'টিকিট দাখিল করুন' : 'Submit Ticket'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Tickets List */}
      <div className="space-y-4">
        {tickets.length === 0 ? (
          <Card className="border border-dashed p-8 text-center text-muted-foreground">
            <p className="font-medium">{language === 'bn' ? 'কোনো সাপোর্ট টিকিট পাওয়া যায়নি।' : 'No support tickets found.'}</p>
            <p className="text-xs mt-1">{language === 'bn' ? 'নতুন টিকিট খুলতে উপরের বাটনে ক্লিক করুন।' : 'Submit a new ticket if you need technical assistance.'}</p>
          </Card>
        ) : (
          tickets.map((ticket) => (
            <Card key={ticket.id} className="border hover:shadow-md transition-shadow">
              <CardContent className="p-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b pb-4 mb-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-bold text-primary">{ticket.id}</span>
                      {getStatusBadge(ticket.status)}
                      {getPriorityBadge(ticket.priority)}
                    </div>
                    <h3 className="text-lg font-bold">{ticket.subject}</h3>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <p>Created: {ticket.createdAt}</p>
                    <p className="text-primary font-medium mt-1">{ticket.lastUpdate}</p>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">{ticket.description}</p>
                <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground pt-2">
                  <span>Category: {ticket.category}</span>
                  <span className="font-medium text-primary">SLA: Response guaranteed &lt; 2 hrs</span>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
