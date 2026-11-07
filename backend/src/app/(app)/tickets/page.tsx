'use client';
import { useState, useEffect } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Plus, MessageSquare, UserCheck, AlertTriangle, CheckCircle, Clock, Save, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { DataTable } from '@/components/DataTable';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { type Ticket as TicketType, type TicketStatus, type TicketPriority } from '@/lib/mockData';
import { formatDate } from '@/lib/utils';
import { useSettingsStore } from '@/store/settingsStore';
import { useAdminDataStore } from '@/store/adminDataStore';

export default function TicketsPage() {
  const t = (en: string, _bn?: string) => en;
  const { tickets, technicians, updateTicketStatus, assignTicketTechnician, addTicketMessage, deleteTicket, clearCollection, saveCollection, fetchData } = useAdminDataStore();
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [replyText, setReplyText] = useState('');

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const selectedTicket = tickets.find(t => t.id === selectedTicketId) || null;

  const handleUpdateStatus = async (id: string, status: TicketStatus) => {
    await updateTicketStatus(id, status);
    toast.success(t('Ticket status updated and saved', 'টিকেটের স্ট্যাটাস আপডেট ও সংরক্ষিত হয়েছে'));
  };

  const handleAssignTechnician = async (ticketId: string, techName: string) => {
    await assignTicketTechnician(ticketId, techName);
    toast.success(t(`Assigned to ${techName} and saved`, `${techName}-এর কাছে দায়িত্ব অর্পণ ও সংরক্ষিত করা হয়েছে`));
  };

  const handleSendReply = async () => {
    if (!replyText.trim() || !selectedTicket) return;
    const newMessage = {
      id: `MSG-${Date.now().toString().slice(-4)}`,
      author: 'Support Agent',
      role: 'support' as const,
      content: replyText,
      timestamp: new Date().toISOString(),
    };
    await addTicketMessage(selectedTicket.id, newMessage);
    setReplyText('');
    toast.success(t('Response dispatched via SMS & Portal and saved', 'এসএমএস ও পোর্টালের মাধ্যমে উত্তর পাঠানো ও সংরক্ষিত হয়েছে'));
  };

  const columns: ColumnDef<TicketType>[] = [
    {
      accessorKey: 'id',
      header: t('Ticket #', 'টিকেট নং'),
      cell: ({ row }) => <span className="font-mono font-medium">{row.original.id}</span>,
    },
    {
      accessorKey: 'subscriberName',
      header: t('Subscriber', 'গ্রাহকের নাম'),
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.subscriberName}</div>
          <div className="text-xs text-muted-foreground font-mono">{row.original.phone}</div>
        </div>
      ),
    },
    {
      accessorKey: 'subject',
      header: t('Subject', 'বিষয়'),
      cell: ({ row }) => <span className="font-medium max-w-[200px] truncate block">{row.original.subject}</span>,
    },
    {
      accessorKey: 'priority',
      header: t('Priority', 'অগ্রাধিকার'),
      cell: ({ row }) => {
        const p = row.original.priority;
        if (p === 'critical') return <Badge className="bg-rose-600 text-white">Critical</Badge>;
        if (p === 'high') return <Badge className="bg-orange-500 text-white">High</Badge>;
        if (p === 'medium') return <Badge className="bg-amber-500 text-white">Medium</Badge>;
        return <Badge variant="secondary">Low</Badge>;
      },
    },
    {
      accessorKey: 'status',
      header: t('Status', 'অবস্থা'),
      cell: ({ row }) => {
        const s = row.original.status;
        if (s === 'open') return <Badge className="bg-blue-500 text-white">Open</Badge>;
        if (s === 'in-progress') return <Badge className="bg-purple-500 text-white">In Progress</Badge>;
        if (s === 'resolved') return <Badge className="bg-emerald-600 text-white">Resolved</Badge>;
        return <Badge variant="outline">Closed</Badge>;
      },
    },
    {
      accessorKey: 'assignedTo',
      header: t('Assigned Technician', 'দায়িত্বপ্রাপ্ত টেকনিশিয়ান'),
      cell: ({ row }) => row.original.assignedTo ? (
        <span className="text-xs font-semibold bg-muted px-2 py-1 rounded-md">{row.original.assignedTo}</span>
      ) : (
        <span className="text-xs text-muted-foreground italic">Unassigned</span>
      ),
    },
    {
      id: 'actions',
      header: t('Actions', 'পদক্ষেপ'),
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="outline" onClick={() => { setSelectedTicketId(row.original.id); setDetailsOpen(true); }}>
            <MessageSquare className="h-3.5 w-3.5 mr-1" />
            {t('Manage', 'ম্যানেজ')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              if (confirm(`Delete support ticket #${row.original.id}?`)) {
                await deleteTicket(row.original.id);
                toast.success(`Ticket #${row.original.id} deleted`);
              }
            }}
            className="h-8 w-8 p-0 text-rose-500 hover:text-rose-600 hover:bg-rose-50"
            title="Delete Ticket"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {t('Helpdesk & CRM Support Tickets', 'হেল্পডেস্ক ও সাপোর্ট টিকেট')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t('Ticket lifecycle, technician dispatching, and field SLA tracking.', 'টিকেটের লাইফসাইকেল, টেকনিশিয়ান অ্যাসাইন এবং ফিল্ড এসএলএ ট্র্যাকিং।')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {tickets.length > 0 && (
            <Button
              variant="outline"
              onClick={async () => {
                if (confirm('Delete all support tickets from the database?')) {
                  await clearCollection('tickets');
                  toast.success('All tickets deleted');
                }
              }}
              className="gap-2 text-rose-600 hover:text-rose-700 hover:bg-rose-50"
            >
              <Trash2 className="h-4 w-4" />
              Delete All Tickets
            </Button>
          )}
          <Button 
            variant="outline" 
            onClick={async () => {
              await saveCollection('tickets', tickets);
              toast.success('Support tickets saved permanently to disk!');
            }}
            className="gap-2 shadow-sm"
          >
            <Save className="h-4 w-4" /> Save Tickets
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">{t('Open Tickets', 'ওপেন টিকেট')}</p>
            <h3 className="text-2xl font-bold text-blue-600 mt-1">{tickets.filter(t => t.status === 'open').length}</h3>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">{t('In Progress', 'চলমান কাজ')}</p>
            <h3 className="text-2xl font-bold text-purple-600 mt-1">{tickets.filter(t => t.status === 'in-progress').length}</h3>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">{t('Resolved', 'সমাধানকৃত')}</p>
            <h3 className="text-2xl font-bold text-emerald-600 mt-1">{tickets.filter(t => t.status === 'resolved').length}</h3>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">{t('Critical SLA', 'জরুরি টিকেট')}</p>
            <h3 className="text-2xl font-bold text-rose-600 mt-1">{tickets.filter(t => t.priority === 'critical' || t.priority === 'high').length}</h3>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>{t('All Support Tickets', 'সকল সাপোর্ট টিকেট তালিকা')}</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={tickets}
            searchKey="subject"
            searchPlaceholder={t('Search ticket subject or issue...', 'টিকেটের বিষয় দিয়ে খুঁজুন...')}
          />
        </CardContent>
      </Card>

      {/* Ticket Management Dialog */}
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          {selectedTicket && (
            <div className="space-y-6 py-2">
              <DialogHeader>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-primary">{selectedTicket.id}</span>
                  <Badge variant="outline">{selectedTicket.priority}</Badge>
                </div>
                <DialogTitle className="text-xl mt-1">{selectedTicket.subject}</DialogTitle>
                <p className="text-xs text-muted-foreground">
                  Subscriber: <span className="font-medium text-foreground">{selectedTicket.subscriberName}</span> ({selectedTicket.phone})
                </p>
              </DialogHeader>

              {/* Status and Assignment Controls */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-xl border p-4 bg-muted/20">
                <div>
                  <Label className="text-xs">{t('Change Status', 'স্ট্যাটাস পরিবর্তন')}</Label>
                  <Select
                    value={selectedTicket.status}
                    onValueChange={(val: TicketStatus) => handleUpdateStatus(selectedTicket.id, val)}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="in-progress">In Progress</SelectItem>
                      <SelectItem value="resolved">Resolved</SelectItem>
                      <SelectItem value="closed">Closed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-xs">{t('Assign Field Technician', 'টেকনিশিয়ান নির্বাচন')}</Label>
                  <Select
                    value={selectedTicket.assignedTo || ''}
                    onValueChange={(val) => handleAssignTechnician(selectedTicket.id, val)}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select Technician" />
                    </SelectTrigger>
                    <SelectContent>
                      {technicians.map(tech => (
                        <SelectItem key={tech.id} value={tech.name}>
                          {tech.name} ({tech.zone} - {tech.status})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Description */}
              <div className="rounded-lg border p-3 bg-muted/10">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Issue Description</p>
                <p className="text-sm">{selectedTicket.description}</p>
              </div>

              {/* Message Thread */}
              <div className="space-y-3">
                <Label className="text-sm font-semibold">{t('Communication Thread', 'যোগাযোগের ইতিহাস')}</Label>
                <div className="space-y-3 max-h-60 overflow-y-auto pr-2">
                  {selectedTicket.messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`p-3 rounded-xl text-sm ${
                        msg.role === 'support' 
                          ? 'bg-primary/10 border border-primary/20 ml-6' 
                          : 'bg-muted border mr-6'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-xs">{msg.author} ({msg.role})</span>
                        <span className="text-[10px] text-muted-foreground">{formatDate(msg.timestamp)}</span>
                      </div>
                      <p>{msg.content}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Reply Box */}
              <div className="space-y-2 pt-2 border-t">
                <Textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder={t('Type SMS or portal message to customer/tech...', 'গ্রাহক বা টেকনিশিয়ানকে বার্তা পাঠান...')}
                  rows={2}
                />
                <div className="flex items-center justify-between gap-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={async () => {
                      if (selectedTicket && confirm(`Delete ticket #${selectedTicket.id}?`)) {
                        await deleteTicket(selectedTicket.id);
                        setDetailsOpen(false);
                        toast.success(`Ticket #${selectedTicket.id} deleted`);
                      }
                    }}
                    className="gap-1.5"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete Ticket
                  </Button>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setDetailsOpen(false)}>
                      {t('Close', 'বন্ধ করুন')}
                    </Button>
                    <Button onClick={handleSendReply}>
                      {t('Send Update', 'বার্তা পাঠান')}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
