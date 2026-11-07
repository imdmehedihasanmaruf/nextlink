'use client';
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, User, Wifi, Receipt, Ticket, Shield, CheckCircle2, Ban, RefreshCw, Phone, Mail, MapPin } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { type Subscriber } from '@/lib/mockData';
import { formatDate } from '@/lib/utils';
import { useSettingsStore, useAdminTranslation } from '@/store/settingsStore';
import { useAdminDataStore } from '@/store/adminDataStore';

export default function SubscriberDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { t } = useAdminTranslation();
  const { subscribers, invoices, tickets, updateSubscriber, fetchData } = useAdminDataStore();

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const subscriberId = params.id as string;
  const sub = subscribers.find(s => s.id === subscriberId);

  if (!sub) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push('/subscribers')} className="h-8 w-8 p-0">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-xl font-bold">Subscriber Details</h1>
        </div>
        <Card className="p-8 text-center border-dashed">
          <p className="text-muted-foreground text-sm">Subscriber with ID &ldquo;{subscriberId}&rdquo; was not found.</p>
          <Button className="mt-4" size="sm" onClick={() => router.push('/subscribers')}>
            Back to Subscribers List
          </Button>
        </Card>
      </div>
    );
  }

  const subInvoices = invoices.filter(i => i.subscriberId === sub.id);
  const subTickets = tickets.filter(t => t.subscriberId === sub.id);

  const handleToggleStatus = async () => {
    const newStatus = sub.status === 'active' ? 'suspended' : 'active';
    await updateSubscriber({ ...sub, status: newStatus });
    if (newStatus === 'suspended') {
      toast.error('Subscriber suspended and saved to disk. MikroTik session halted.');
    } else {
      toast.success('Subscriber reactivated and saved to disk. MikroTik connection enabled.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push('/subscribers')} className="h-8 w-8 p-0">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{sub.name}</h1>
          <p className="text-xs text-muted-foreground font-mono">ID: {sub.id} • PPPoE: {sub.phone}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant={sub.status === 'active' ? 'destructive' : 'default'}
            size="sm"
            onClick={handleToggleStatus}
            className="gap-1.5 shadow"
          >
            {sub.status === 'active' ? (
              <>
                <Ban className="h-4 w-4" />
                Suspend Line
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" />
                Reconnect Line
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Profile Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <User className="h-4 w-4 text-primary" />
              Subscriber Profile
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <span className="text-xs text-muted-foreground">Mobile Phone</span>
              <p className="font-semibold flex items-center gap-1.5 mt-0.5">
                <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                {sub.phone}
              </p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Email Address</span>
              <p className="font-semibold flex items-center gap-1.5 mt-0.5">
                <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                {sub.email}
              </p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Address & Zone</span>
              <p className="font-semibold flex items-center gap-1.5 mt-0.5">
                <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                {sub.address}, {sub.zone}
              </p>
            </div>
            <div className="pt-2 border-t">
              <span className="text-xs text-muted-foreground">Joined Date</span>
              <p className="font-medium mt-0.5">{formatDate(sub.joinDate)}</p>
            </div>
          </CardContent>
        </Card>

        {/* Network & Mikrotik Info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Wifi className="h-4 w-4 text-primary" />
              Network & MikroTik Sync
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <span className="text-xs text-muted-foreground">Active Package</span>
              <p className="font-bold text-primary mt-0.5">{sub.packageName}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Assigned IP</span>
              <p className="font-mono mt-0.5">{sub.ipAddress || '103.145.112.55'}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">ONT MAC Address</span>
              <p className="font-mono mt-0.5">{sub.macAddress || '48:8D:36:1B:02:AA'}</p>
            </div>
            <div className="pt-2 border-t">
              <span className="text-xs text-muted-foreground">Router Session Status</span>
              <div className="mt-1">
                {sub.status === 'active' ? (
                  <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30">MikroTik UP (Active)</Badge>
                ) : (
                  <Badge className="bg-rose-500/10 text-rose-600 border-rose-500/30">Queue Disabled</Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Balance & Billing Info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Receipt className="h-4 w-4 text-primary" />
              Billing Overview
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <span className="text-xs text-muted-foreground">Current Outstanding Balance</span>
              <p className="text-2xl font-extrabold text-primary mt-0.5">$ {sub.balance.toLocaleString()}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Next Due Date</span>
              <p className="font-semibold text-amber-600 mt-0.5">{formatDate(sub.dueDate)}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Lifetime Total Paid</span>
              <p className="font-semibold mt-0.5">$ {sub.totalPaid.toLocaleString()}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Invoices list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Billing History & Invoices</CardTitle>
        </CardHeader>
        <CardContent>
          {subInvoices.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No past invoices recorded.</p>
          ) : (
            <div className="divide-y text-sm">
              {subInvoices.map(i => (
                <div key={i.id} className="py-3 flex items-center justify-between">
                  <div>
                    <span className="font-mono font-bold">{i.id}</span>
                    <span className="text-muted-foreground ml-2">({i.month})</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="font-bold">$ {i.amount.toLocaleString()}</span>
                    <Badge variant={i.status === 'paid' ? 'secondary' : 'destructive'}>{i.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
