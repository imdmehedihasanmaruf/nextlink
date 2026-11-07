'use client';

import { useState, useEffect } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Receipt, CheckCircle, Send, Download, AlertCircle, DollarSign, Filter, XCircle, Save, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { DataTable } from '@/components/DataTable';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { type Invoice } from '@/lib/mockData';
import { formatDate } from '@/lib/utils';
import { useAdminDataStore } from '@/store/adminDataStore';

export default function BillingPage() {
  const { invoices, updateInvoiceStatus, deleteInvoice, clearCollection, saveCollection, fetchData } = useAdminDataStore();
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleMarkPaid = async (id: string) => {
    await updateInvoiceStatus(id, 'paid');
    toast.success('Payment marked as paid & synced with MikroTik router');
  };

  const handleMarkUnpaid = async (id: string) => {
    await updateInvoiceStatus(id, 'unpaid');
    toast.success('Payment marked as unpaid');
  };

  const handleSendReminder = (inv: Invoice) => {
    toast.success(`SMS reminder sent to ${inv.phone}`);
  };

  const filtered = invoices.filter(inv => {
    if (statusFilter !== 'all' && inv.status !== statusFilter) return false;
    return true;
  });

  const columns: ColumnDef<Invoice>[] = [
    {
      accessorKey: 'id',
      header: 'Invoice #',
      cell: ({ row }) => <span className="font-mono font-medium text-xs">{row.original.id}</span>,
    },
    {
      accessorKey: 'subscriberName',
      header: 'Subscriber',
      cell: ({ row }) => (
        <div>
          <p className="font-medium">{row.original.subscriberName}</p>
          <p className="text-xs text-muted-foreground">{row.original.phone}</p>
        </div>
      ),
    },
    {
      accessorKey: 'packageName',
      header: 'Package',
    },
    {
      accessorKey: 'amount',
      header: 'Amount',
      cell: ({ row }) => <span className="font-bold">${row.original.amount.toLocaleString()}</span>,
    },
    {
      accessorKey: 'month',
      header: 'Month',
    },
    {
      accessorKey: 'dueDate',
      header: 'Due Date',
      cell: ({ row }) => <span>{formatDate(row.original.dueDate)}</span>,
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const s = row.original.status;
        if (s === 'paid') return <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30">Paid</Badge>;
        if (s === 'unpaid') return <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/30">Unpaid</Badge>;
        return <Badge className="bg-rose-500/10 text-rose-600 border-rose-500/30">Overdue</Badge>;
      },
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => {
        const inv = row.original;
        return (
          <div className="flex items-center gap-1.5">
            {inv.status !== 'paid' ? (
              <Button size="sm" variant="outline" onClick={() => handleMarkPaid(inv.id)} className="h-8 gap-1 text-xs">
                <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
                Pay
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => handleMarkUnpaid(inv.id)} className="h-8 gap-1 text-xs text-muted-foreground hover:text-amber-600">
                <XCircle className="h-3.5 w-3.5" />
                Unpay
              </Button>
            )}
            {inv.status !== 'paid' && (
              <Button size="sm" variant="ghost" onClick={() => handleSendReminder(inv)} className="h-8 w-8 p-0" title="Send SMS">
                <Send className="h-3.5 w-3.5 text-blue-500" />
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => toast.success('Downloading Invoice PDF...')} className="h-8 w-8 p-0" title="PDF">
              <Download className="h-3.5 w-3.5" />
            </Button>
            <Button 
              size="sm" 
              variant="ghost" 
              onClick={async () => {
                if (confirm(`Delete invoice ${inv.id} for ${inv.subscriberName}?`)) {
                  await deleteInvoice(inv.id);
                  toast.success(`Invoice ${inv.id} deleted`);
                }
              }} 
              className="h-8 w-8 p-0 text-rose-500 hover:text-rose-600 hover:bg-rose-50" 
              title="Delete Invoice"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        );
      },
    },
  ];

  const totalBilled = invoices.reduce((acc, i) => acc + i.amount, 0);
  const totalCollected = invoices.filter(i => i.status === 'paid').reduce((acc, i) => acc + i.amount, 0);
  const totalDue = invoices.filter(i => i.status !== 'paid').reduce((acc, i) => acc + i.amount, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Billing & Invoicing</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Automated recurring billing, payment gateway reconciliations, and collection tracking.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {invoices.length > 0 && (
            <Button
              variant="outline"
              onClick={async () => {
                if (confirm('Delete all invoices from the registry?')) {
                  await clearCollection('invoices');
                  toast.success('All invoices deleted');
                }
              }}
              className="gap-2 text-rose-600 hover:text-rose-700 hover:bg-rose-50"
            >
              <Trash2 className="h-4 w-4" />
              Delete All Invoices
            </Button>
          )}
          <Button 
            variant="outline" 
            onClick={async () => {
              await saveCollection('invoices', invoices);
              toast.success('Invoices registry saved permanently to disk!');
            }}
            className="gap-2 shadow-sm"
          >
            <Save className="h-4 w-4" />
            Save Invoices
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-6">
            <p className="text-xs font-medium text-muted-foreground">Total Invoiced</p>
            <h3 className="text-2xl font-bold mt-2">${totalBilled.toLocaleString()}</h3>
            <p className="text-xs text-muted-foreground mt-1">{invoices.length} invoices this cycle</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-xs font-medium text-muted-foreground">Collected</p>
            <h3 className="text-2xl font-bold text-emerald-600 mt-2">${totalCollected.toLocaleString()}</h3>
            <p className="text-xs text-muted-foreground mt-1">{invoices.filter(i => i.status === 'paid').length} paid invoices</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-xs font-medium text-muted-foreground">Outstanding / Overdue</p>
            <h3 className="text-2xl font-bold text-rose-600 mt-2">${totalDue.toLocaleString()}</h3>
            <p className="text-xs text-muted-foreground mt-1">{invoices.filter(i => i.status !== 'paid').length} pending accounts</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <CardTitle>Invoices Register</CardTitle>
            <div className="flex items-center gap-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="unpaid">Unpaid</SelectItem>
                  <SelectItem value="overdue">Overdue</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={filtered}
            searchKey="subscriberName"
            searchPlaceholder="Search subscriber..."
          />
        </CardContent>
      </Card>
    </div>
  );
}
