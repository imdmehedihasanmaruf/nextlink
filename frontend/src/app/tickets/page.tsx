'use client'

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  PlusCircle,
  MessageSquare,
  AlertCircle,
  CheckCircle,
  Clock,
  Send,
  Search,
  Filter,
  Paperclip,
  X,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  UserCheck,
  CheckCircle2,
  Lock,
  RefreshCw,
  FileText,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/select'
import { useTranslation, useSettingsStore } from '@/store/settingsStore'
import { useAuthStore } from '@/store/authStore'
import {
  createTicket,
  fetchMyTickets,
  fetchTicket,
  replyToTicket,
  updateTicketStatus,
  type PortalTicket,
} from '@/lib/portalApi'
import { useModalA11y } from '@/lib/useModalA11y'

interface Ticket {
  id: string
  subject: string
  category: string
  priority: 'low' | 'medium' | 'high' | 'critical'
  status: 'Open' | 'In Progress' | 'Resolved'
  createdAt: string
  lastUpdate: string
  description: string
  assignedToName?: string | null
  slaDueAt?: string | null
  attachment?: {
    name: string
    size: number
    type: string
    dataUrl?: string
  } | null
}

interface ThreadMessage {
  id: string
  author_type: 'subscriber' | 'staff'
  author_name?: string
  body: string
  created_at: string
}

export default function TicketsPage() {
  const router = useRouter()
  const { isAuthenticated, hasHydrated, user } = useAuthStore()
  const { t, language } = useTranslation()
  const autoSave = useSettingsStore((s) => s.autoSave)

  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)

  // Filters & Search & Pagination
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'in_progress' | 'resolved'>('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 5

  // Form states
  const TICKET_CATEGORIES = [
    'Fiber / Optical Issue',
    'Slow Speed',
    'Billing & Plan',
    'Configuration',
    'Other',
  ]
  const [subject, setSubject] = useState('')
  const [category, setCategory] = useState(TICKET_CATEGORIES[0])
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'critical'>('medium')
  const [description, setDescription] = useState('')
  const [attachment, setAttachment] = useState<{ name: string; size: number; type: string; dataUrl: string } | null>(null)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [submittedMessage, setSubmittedMessage] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Ticket Detail & Conversation Thread Modal
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null)
  const [threadMessages, setThreadMessages] = useState<ThreadMessage[]>([])
  const [threadLoading, setThreadLoading] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [isReplying, setIsReplying] = useState(false)
  const [isClosingTicket, setIsClosingTicket] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)

  useModalA11y(modalOpen, () => setModalOpen(false))

  const toTicket = (row: PortalTicket): Ticket => {
    const raw = row.raw_data || {}
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
      assignedToName: row.assigned_to_name || null,
      slaDueAt: row.sla_due_at || null,
      attachment: raw.attachment || null,
    }
  }

  const loadTickets = useCallback(async () => {
    if (!isAuthenticated) return
    const result = await fetchMyTickets()
    if (result.success && Array.isArray(result.tickets)) {
      setTickets(result.tickets.map(toTicket))
    }
  }, [isAuthenticated])

  // Poll tickets every 4 seconds for real-time updates
  useEffect(() => {
    if (hasHydrated && isAuthenticated) {
      setLoading(true)
      loadTickets().finally(() => setLoading(false))
      const timer = setInterval(() => {
        loadTickets()
      }, 4000)
      return () => clearInterval(timer)
    }
  }, [hasHydrated, isAuthenticated, loadTickets])

  // Load ticket details and message thread
  const openTicketThread = async (ticket: Ticket) => {
    setSelectedTicket(ticket)
    setModalOpen(true)
    setThreadLoading(true)
    setReplyText('')

    const res = await fetchTicket(ticket.id)
    setThreadLoading(false)
    if (res.success && res.ticket) {
      if (Array.isArray(res.ticket.thread)) {
        setThreadMessages(res.ticket.thread)
      } else {
        setThreadMessages([])
      }
    }
  }

  // Poll message thread while modal is open
  useEffect(() => {
    if (!modalOpen || !selectedTicket) return
    const interval = setInterval(async () => {
      const res = await fetchTicket(selectedTicket.id)
      if (res.success && res.ticket && Array.isArray(res.ticket.thread)) {
        setThreadMessages(res.ticket.thread)
        const updatedStatus = (res.ticket.status || 'open').toLowerCase()
        if (
          (updatedStatus === 'resolved' || updatedStatus === 'closed') &&
          selectedTicket.status !== 'Resolved'
        ) {
          setSelectedTicket((prev) => (prev ? { ...prev, status: 'Resolved' } : null))
        }
      }
    }, 4000)
    return () => clearInterval(interval)
  }, [modalOpen, selectedTicket])

  // Auto-save draft
  useEffect(() => {
    if (autoSave) {
      const saved = localStorage.getItem('draft_ticket')
      if (saved) {
        try {
          const parsed = JSON.parse(saved)
          setSubject(parsed.subject || '')
          setCategory(TICKET_CATEGORIES.includes(parsed.category) ? parsed.category : TICKET_CATEGORIES[0])
          setPriority(parsed.priority || 'medium')
          setDescription(parsed.description || '')
        } catch {}
      }
    }
  }, [autoSave])

  useEffect(() => {
    if (autoSave) {
      localStorage.setItem('draft_ticket', JSON.stringify({ subject, category, priority, description }))
    }
  }, [subject, category, priority, description, autoSave])

  // Handle Attachment Upload (Max 5MB, PDF or Images)
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAttachmentError(null)
    const file = e.target.files?.[0]
    if (!file) return

    const MAX_BYTES = 5 * 1024 * 1024 // 5MB
    if (file.size > MAX_BYTES) {
      setAttachmentError('Attachment exceeds the 5MB maximum file size limit.')
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']
    if (!allowedTypes.includes(file.type)) {
      setAttachmentError('Only images (JPEG, PNG, WebP) and PDF documents are allowed.')
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      setAttachment({
        name: file.name,
        size: file.size,
        type: file.type,
        dataUrl: String(reader.result || ''),
      })
    }
    reader.readAsDataURL(file)
  }

  const handleRemoveAttachment = () => {
    setAttachment(null)
    setAttachmentError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // Submit Ticket Form
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isAuthenticated) {
      router.push('/login?redirect=tickets')
      return
    }

    if (subject.trim().length < 5) {
      setSubmitError('Subject must be at least 5 characters long.')
      return
    }
    if (description.trim().length < 10) {
      setSubmitError('Description must be at least 10 characters long.')
      return
    }

    setSubmitError('')
    setIsSubmitting(true)

    const result = await createTicket({
      subject: subject.trim(),
      category,
      priority,
      description: description.trim(),
      attachment,
    })

    setIsSubmitting(false)

    if (!result.success) {
      setSubmitError(result.error || 'We could not submit your ticket. Please try again.')
      return
    }

    setSubject('')
    setDescription('')
    handleRemoveAttachment()
    if (autoSave) {
      localStorage.removeItem('draft_ticket')
    }
    setShowForm(false)
    setSubmittedMessage(
      language === 'bn' ? 'আপনার টিকিট সফলভাবে জমা হয়েছে!' : 'Your support ticket has been submitted!'
    )
    setTimeout(() => setSubmittedMessage(''), 4000)

    loadTickets()
  }

  // Reply to ticket
  const handleSendReply = async () => {
    if (!selectedTicket || !replyText.trim() || isReplying) return
    setIsReplying(true)
    const res = await replyToTicket(selectedTicket.id, replyText.trim())
    setIsReplying(false)
    if (res.success && res.message) {
      setThreadMessages((prev) => [...prev, res.message])
      setReplyText('')
    }
  }

  // Close ticket as resolved
  const handleCloseTicket = async () => {
    if (!selectedTicket || isClosingTicket) return
    if (!confirm('Are you sure you want to close this ticket? It will be marked as resolved.')) {
      return
    }
    setIsClosingTicket(true)
    const res = await updateTicketStatus(selectedTicket.id, 'closed')
    setIsClosingTicket(false)
    if (res.success) {
      setSelectedTicket((prev) => (prev ? { ...prev, status: 'Resolved' } : null))
      loadTickets()
    }
  }

  // Filtered and Paginated Tickets
  const filteredTickets = useMemo(() => {
    return tickets.filter((t) => {
      if (statusFilter === 'open' && t.status !== 'Open') return false
      if (statusFilter === 'in_progress' && t.status !== 'In Progress') return false
      if (statusFilter === 'resolved' && t.status !== 'Resolved') return false
      if (categoryFilter !== 'all' && t.category !== categoryFilter) return false

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const matchId = t.id.toLowerCase().includes(q)
        const matchSubject = t.subject.toLowerCase().includes(q)
        const matchDesc = t.description.toLowerCase().includes(q)
        return matchId || matchSubject || matchDesc
      }
      return true
    })
  }, [tickets, statusFilter, categoryFilter, searchQuery])

  const totalPages = Math.max(1, Math.ceil(filteredTickets.length / pageSize))
  const paginatedTickets = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return filteredTickets.slice(start, start + pageSize)
  }, [filteredTickets, currentPage])

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
        return <Badge className="bg-emerald-600 text-white">Resolved</Badge>
      default:
        return <Badge variant="outline">{s}</Badge>
    }
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b pb-6">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">
            {language === 'bn' ? 'গ্রাহক সহায়তা ও অভিযোগ ডায়েরি' : 'Helpdesk & Support Tickets'}
          </h1>
          <p className="text-muted-foreground mt-1 text-xs sm:text-sm">
            {language === 'bn'
              ? 'ইন্টারনেট সমস্যা বা সার্ভিসের জন্য সরাসরি টেকনিক্যাল টিমের সাথে যোগাযোগ করুন।'
              : 'Direct CRM ticket routing to regional field technicians with real-time SLA tracking.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => {
              if (!isAuthenticated) {
                router.push('/login?redirect=tickets')
                return
              }
              setShowForm(!showForm)
            }}
            className="gap-2 font-bold"
          >
            <PlusCircle className="h-4 w-4" />
            {showForm
              ? language === 'bn'
                ? 'ফর্ম বন্ধ করুন'
                : 'Cancel'
              : language === 'bn'
                ? 'নতুন টিকিট খুলুন'
                : 'New Ticket'}
          </Button>
        </div>
      </div>

      {submittedMessage && (
        <div className="rounded-xl border border-emerald-500/50 bg-emerald-500/10 p-4 text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
          <CheckCircle className="h-5 w-5" />
          <span className="font-semibold text-sm">{submittedMessage}</span>
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
                <Label htmlFor="subject" className="text-xs font-semibold">
                  {language === 'bn' ? 'বিষয় / শিরোনাম' : 'Subject / Issue Title'}{' '}
                  <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder={
                    language === 'bn'
                      ? 'যেমন: ইন্টারনেটের স্পিড ধীরগতি'
                      : 'e.g. Optical LOS red light on router or sudden latency'
                  }
                  required
                  minLength={5}
                  className="mt-1"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="category" className="text-xs font-semibold">
                    {language === 'bn' ? 'ক্যাটাগরি' : 'Category'}
                  </Label>
                  <Select
                    id="category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="mt-1"
                  >
                    <option value="Fiber / Optical Issue">Fiber / Optical Issue (LOS)</option>
                    <option value="Slow Speed">Slow Speed / Latency</option>
                    <option value="Billing & Plan">Billing / Payment Query</option>
                    <option value="Configuration">Router / Wi-Fi Setup</option>
                    <option value="Other">Other Query</option>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="priority" className="text-xs font-semibold">
                    {language === 'bn' ? 'অগ্রাধিকার (Priority)' : 'Priority'}
                  </Label>
                  <Select
                    id="priority"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as any)}
                    className="mt-1"
                  >
                    <option value="low">Low (General Query)</option>
                    <option value="medium">Medium (Standard)</option>
                    <option value="high">High (Work / Streaming Impacted)</option>
                    <option value="critical">Critical (Total Outage / Fiber Cut)</option>
                  </Select>
                </div>
              </div>

              <div>
                <Label htmlFor="description" className="text-xs font-semibold">
                  {language === 'bn' ? 'বিস্তারিত বিবরণ' : 'Detailed Description'}{' '}
                  <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  placeholder={
                    language === 'bn'
                      ? 'আপনার সমস্যার বিস্তারিত তথ্য দিন...'
                      : 'Describe what happened, error codes on router, or affected devices...'
                  }
                  required
                  minLength={10}
                  className="mt-1 text-xs sm:text-sm"
                />
              </div>

              {/* Attachment file upload */}
              <div>
                <Label className="text-xs font-semibold">
                  Optional Attachment <span className="text-muted-foreground font-normal">(Images, PDF up to 5MB)</span>
                </Label>
                <div className="mt-1.5 flex items-center gap-3">
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    accept=".jpg,.jpeg,.png,.webp,.pdf"
                    className="text-xs file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-primary file:text-primary-foreground hover:file:opacity-90"
                  />
                  {attachment && (
                    <div className="flex items-center gap-1.5 text-xs bg-muted/60 px-2.5 py-1 rounded-md border font-mono">
                      <Paperclip className="h-3 w-3 text-primary" />
                      <span className="truncate max-w-[200px]">{attachment.name}</span>
                      <span className="text-muted-foreground text-[10px]">
                        ({(attachment.size / 1024).toFixed(0)} KB)
                      </span>
                      <button
                        type="button"
                        onClick={handleRemoveAttachment}
                        className="ml-1 text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
                {attachmentError && (
                  <p className="text-xs text-destructive mt-1 font-semibold">{attachmentError}</p>
                )}
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
                <Button type="submit" className="gap-2 font-bold" disabled={isSubmitting}>
                  <Send className="h-4 w-4" />
                  {isSubmitting
                    ? language === 'bn'
                      ? 'পাঠানো হচ্ছে...'
                      : 'Submitting...'
                    : language === 'bn'
                      ? 'টিকিট দাখিল করুন'
                      : 'Submit Ticket'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Filter and Search Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-4 rounded-xl border bg-card shadow-xs">
        <div className="relative flex-1 max-w-sm">
          <Search className="h-4 w-4 absolute left-3 top-2.5 text-muted-foreground" />
          <Input
            placeholder="Search by ticket ID or subject..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              setCurrentPage(1)
            }}
            className="pl-9 h-9 text-xs"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Status filter */}
          <div className="flex items-center rounded-lg border bg-muted/40 p-0.5 text-xs">
            {(['all', 'open', 'in_progress', 'resolved'] as const).map((st) => (
              <Button
                key={st}
                size="sm"
                variant={statusFilter === st ? 'secondary' : 'ghost'}
                onClick={() => {
                  setStatusFilter(st)
                  setCurrentPage(1)
                }}
                className="h-7 text-xs capitalize px-2.5"
              >
                {st.replace('_', ' ')}
              </Button>
            ))}
          </div>

          {/* Category filter */}
          <Select
            value={categoryFilter}
            onChange={(e) => {
              setCategoryFilter(e.target.value)
              setCurrentPage(1)
            }}
            className="h-8 text-xs w-36"
          >
            <option value="all">All Categories</option>
            {TICKET_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {/* Tickets List */}
      <div className="space-y-4">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((n) => (
              <Card key={n} className="border p-6 animate-pulse">
                <div className="h-4 w-1/4 bg-muted rounded mb-3" />
                <div className="h-3 w-3/4 bg-muted rounded" />
              </Card>
            ))}
          </div>
        ) : paginatedTickets.length === 0 ? (
          <Card className="border border-dashed p-12 text-center text-muted-foreground">
            <div className="flex flex-col items-center justify-center gap-2">
              <CheckCircle2 className="h-10 w-10 text-muted-foreground/50" />
              <p className="font-bold text-foreground text-base">
                {language === 'bn' ? 'কোনো সাপোর্ট টিকিট পাওয়া যায়নি।' : 'No support tickets found.'}
              </p>
              <p className="text-xs text-muted-foreground max-w-sm">
                {language === 'bn'
                  ? 'নতুন টিকিট খুলতে উপরের বাটনে ক্লিক করুন।'
                  : 'You have no tickets matching this filter. Submit a new ticket if you need technical assistance.'}
              </p>
            </div>
          </Card>
        ) : (
          paginatedTickets.map((ticket) => (
            <Card
              key={ticket.id}
              className="border hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => openTicketThread(ticket)}
            >
              <CardContent className="p-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b pb-4 mb-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono font-bold text-primary">{ticket.id}</span>
                      {getStatusBadge(ticket.status)}
                      {getPriorityBadge(ticket.priority)}
                    </div>
                    <h3 className="text-base sm:text-lg font-bold text-foreground">{ticket.subject}</h3>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <p>Created: {ticket.createdAt}</p>
                    <p className="text-primary font-medium mt-1">{ticket.lastUpdate}</p>
                  </div>
                </div>

                <p className="text-xs sm:text-sm text-muted-foreground line-clamp-2">{ticket.description}</p>

                <div className="mt-4 flex flex-wrap items-center justify-between text-xs text-muted-foreground pt-2 gap-2">
                  <div className="flex items-center gap-3">
                    <span>Category: <strong>{ticket.category}</strong></span>
                    {ticket.attachment && (
                      <span className="inline-flex items-center gap-1 text-primary font-mono">
                        <Paperclip className="h-3 w-3" />
                        Attached file
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-primary">
                      {ticket.slaDueAt
                        ? `SLA Due: ${new Date(ticket.slaDueAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                        : 'SLA: Response < 2 hrs'}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs font-semibold gap-1"
                      onClick={(e) => {
                        e.stopPropagation()
                        openTicketThread(ticket)
                      }}
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                      View Thread
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}

        {/* Pagination */}
        {filteredTickets.length > pageSize && (
          <div className="flex items-center justify-between pt-2 border-t text-xs text-muted-foreground">
            <span>
              Showing {(currentPage - 1) * pageSize + 1}–
              {Math.min(currentPage * pageSize, filteredTickets.length)} of {filteredTickets.length} tickets
            </span>
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="h-7 px-2 text-xs"
              >
                <ChevronLeft className="h-3.5 w-3.5" /> Prev
              </Button>
              <span className="font-mono px-2">
                Page {currentPage} / {totalPages}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="h-7 px-2 text-xs"
              >
                Next <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Ticket Details & Conversation Thread Modal */}
      {modalOpen && selectedTicket && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-label="Support ticket conversation thread"
        >
          <Card className="w-full max-w-2xl bg-card border shadow-2xl animate-in zoom-in-95 my-8 flex flex-col max-h-[85vh]">
            <CardHeader className="border-b pb-4 flex flex-row items-center justify-between shrink-0">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-primary">{selectedTicket.id}</span>
                  {getStatusBadge(selectedTicket.status)}
                  {getPriorityBadge(selectedTicket.priority)}
                </div>
                <h3 className="font-bold text-base text-foreground leading-tight">{selectedTicket.subject}</h3>
                <p className="text-xs text-muted-foreground">
                  Category: <strong>{selectedTicket.category}</strong> • Opened: {selectedTicket.createdAt}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {selectedTicket.status !== 'Resolved' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleCloseTicket}
                    disabled={isClosingTicket}
                    className="h-8 text-xs font-bold border-emerald-500/50 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                    title="Close ticket if your issue is resolved"
                  >
                    <CheckCircle className="h-3.5 w-3.5 mr-1" />
                    Close Ticket
                  </Button>
                )}
                <button
                  onClick={() => setModalOpen(false)}
                  className="p-1.5 rounded-full hover:bg-muted text-muted-foreground"
                >
                  <X size={18} />
                </button>
              </div>
            </CardHeader>

            {/* Conversation Body */}
            <CardContent className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1 text-xs sm:text-sm">
              {/* Ticket Metadata Bar */}
              <div className="p-3 rounded-xl bg-muted/40 border text-xs flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <UserCheck className="h-4 w-4 text-primary" />
                  <span>
                    Technician:{' '}
                    <strong>{selectedTicket.assignedToName || 'Awaiting Helpdesk assignment'}</strong>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-amber-600" />
                  <span>
                    SLA Deadline:{' '}
                    <strong>
                      {selectedTicket.slaDueAt
                        ? new Date(selectedTicket.slaDueAt).toLocaleString()
                        : 'Under 2 hours'}
                    </strong>
                  </span>
                </div>
              </div>

              {/* Initial Ticket Description Post */}
              <div className="rounded-xl border bg-card p-4 space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground border-b pb-2">
                  <span className="font-semibold text-foreground">Initial Problem Description</span>
                  <span className="font-mono">{selectedTicket.createdAt}</span>
                </div>
                <p className="text-foreground whitespace-pre-wrap">{selectedTicket.description}</p>
                {selectedTicket.attachment && (
                  <div className="mt-3 pt-2 border-t flex items-center gap-2 text-xs">
                    <Paperclip className="h-3.5 w-3.5 text-primary" />
                    <span className="font-semibold">Attached File:</span>
                    <a
                      href={selectedTicket.attachment.dataUrl || '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline font-mono"
                    >
                      {selectedTicket.attachment.name} ({(selectedTicket.attachment.size / 1024).toFixed(0)} KB)
                    </a>
                  </div>
                )}
              </div>

              {/* Message Thread */}
              <div className="space-y-3 pt-2">
                <h4 className="font-bold text-xs uppercase tracking-wider text-muted-foreground">
                  Discussion Thread ({threadMessages.length})
                </h4>

                {threadLoading ? (
                  <div className="py-6 text-center text-muted-foreground text-xs">
                    <RefreshCw className="h-4 w-4 animate-spin mx-auto mb-2 text-primary" />
                    Loading conversation messages...
                  </div>
                ) : threadMessages.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic py-2">
                    No replies yet. A NextLink NOC technician or helpdesk agent will update you shortly.
                  </p>
                ) : (
                  threadMessages.map((msg) => {
                    const isStaff = msg.author_type === 'staff'
                    return (
                      <div
                        key={msg.id}
                        className={`p-3.5 rounded-xl border text-xs space-y-1.5 ${
                          isStaff
                            ? 'bg-primary/5 border-primary/20 ml-4'
                            : 'bg-muted/30 border-border mr-4'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            {isStaff ? (
                              <Badge className="bg-primary text-primary-foreground text-[10px]">
                                NextLink Support
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px]">
                                You (Subscriber)
                              </Badge>
                            )}
                            {msg.author_name && (
                              <span className="font-semibold text-foreground">{msg.author_name}</span>
                            )}
                          </div>
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {new Date(msg.created_at).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                        <p className="text-foreground whitespace-pre-wrap">{msg.body}</p>
                      </div>
                    )
                  })
                )}
              </div>
            </CardContent>

            {/* Reply Input Box */}
            <div className="p-4 border-t bg-card shrink-0 space-y-2">
              {selectedTicket.status === 'Resolved' ? (
                <div className="p-2.5 rounded-lg bg-muted text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
                  <Lock className="h-3.5 w-3.5" />
                  <span>This ticket has been marked as resolved. Open a new ticket if you need further help.</span>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Input
                    placeholder="Type your reply or additional information..."
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        handleSendReply()
                      }
                    }}
                    className="text-xs h-9"
                  />
                  <Button
                    size="sm"
                    onClick={handleSendReply}
                    disabled={isReplying || !replyText.trim()}
                    className="h-9 px-4 font-bold text-xs shrink-0 gap-1.5"
                  >
                    <Send className="h-3.5 w-3.5" />
                    <span>{isReplying ? 'Sending…' : 'Reply'}</span>
                  </Button>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
