'use client';
import { useState, useEffect } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { MoreHorizontal, Plus, Eye, Ban, Wifi, Phone, Trash2, Save } from 'lucide-react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { DataTable } from '@/components/DataTable';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { type Subscriber } from '@/lib/mockData';
import { getStatusColor, formatDate } from '@/lib/utils';
import { useSettingsStore, useAdminTranslation } from '@/store/settingsStore';
import { useAdminDataStore } from '@/store/adminDataStore';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const schema = z.object({
  name: z.string().min(2),
  phone: z.string().min(10),
  email: z.string().email(),
  address: z.string().min(5),
  zone: z.string().min(2),
  packageId: z.string().min(1, 'Select a package'),
});
type FormValues = z.infer<typeof schema>;

export default function SubscribersPage() {
  const { t } = useAdminTranslation();
  const { subscribers, packages, addSubscriber, updateSubscriber, deleteSubscriber, clearCollection, saveCollection, fetchData } = useAdminDataStore();
  const [addOpen, setAddOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [zoneFilter, setZoneFilter] = useState('all');

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  const filtered = subscribers.filter(s => {
    if (statusFilter !== 'all' && s.status !== statusFilter) return false;
    if (zoneFilter !== 'all' && s.zone !== zoneFilter) return false;
    return true;
  });

  const zones = Array.from(new Set(subscribers.map(s => s.zone))).sort();

  const columns: ColumnDef<Subscriber>[] = [
    { accessorKey: 'id', header: 'ID', cell: ({ row }) => <span className="font-mono text-xs font-bold">{row.original.id}</span> },
    { accessorKey: 'name', header: 'Name', cell: ({ row }) => (
      <div>
        <p className="font-medium">{row.original.name}</p>
        <p className="text-xs text-muted-foreground font-mono">{row.original.phone}</p>
      </div>
    )},
    { accessorKey: 'packageName', header: 'Package' },
    { accessorKey: 'zone', header: 'Zone' },
    { accessorKey: 'status', header: 'Status', cell: ({ row }) => (
      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${getStatusColor(row.original.status)}`}>
        {row.original.status}
      </span>
    )},
    { accessorKey: 'dueDate', header: 'Due Date', cell: ({ row }) => formatDate(row.original.dueDate) },
    { id: 'actions', header: 'Actions', cell: ({ row }) => (
      <div className="flex items-center gap-1">
        <Link href={`/subscribers/${row.original.id}`}>
          <Button variant="ghost" size="icon" title="View Details"><Eye className="h-4 w-4" /></Button>
        </Link>
        <Button
          variant="ghost"
          size="icon"
          title={row.original.status === 'active' ? 'Suspend Line' : 'Reconnect Line'}
          onClick={async () => {
            const nextStatus = row.original.status === 'active' ? 'suspended' : 'active';
            await updateSubscriber({ ...row.original, status: nextStatus });
            toast.success(nextStatus === 'suspended' ? 'Subscriber suspended and saved to disk' : 'Subscriber reconnected and saved to disk');
          }}
        >
          {row.original.status === 'active' ? <Ban className="h-4 w-4 text-rose-500" /> : <Wifi className="h-4 w-4 text-emerald-500" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="Delete Subscriber"
          className="text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
          onClick={async () => {
            if (confirm(`Delete subscriber ${row.original.name}?`)) {
              await deleteSubscriber(row.original.id);
              toast.success('Subscriber deleted and saved permanently to disk');
            }
          }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    )},
  ];

  const onAdd = async (data: FormValues) => {
    const pkg = packages.find(p => p.id === data.packageId);
    const newSub: Subscriber = {
      id: `SUB-${String(subscribers.length + 1).padStart(3, '0')}`,
      ...data,
      packageName: pkg?.name || data.packageId,
      status: 'active',
      dueDate: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
      joinDate: new Date().toISOString().split('T')[0],
      connectionType: 'Fiber',
      ipAddress: `192.168.1.${subscribers.length + 101}`,
      macAddress: `AA:BB:CC:DD:FF:${String(subscribers.length + 1).padStart(2, '0')}`,
      balance: 0,
      totalPaid: 0,
      email: data.email,
    };
    await addSubscriber(newSub);
    toast.success('New subscriber created and saved permanently to disk!');
    reset();
    setAddOpen(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{t('subscribers', 'Subscribers')}</h1>
          </div>
          <p className="text-muted-foreground text-sm mt-0.5">Manage all ISP subscriber accounts. (Auto-persisted to disk)</p>
        </div>
        <div className="flex items-center gap-2">
          {subscribers.length > 0 && (
            <Button
              variant="outline"
              onClick={async () => {
                if (confirm('Delete all subscribers from the database?')) {
                  await clearCollection('subscribers');
                  toast.success('All subscribers deleted');
                }
              }}
              className="gap-2 text-rose-600 hover:text-rose-700 hover:bg-rose-50"
            >
              <Trash2 className="h-4 w-4" />
              Delete All Subscribers
            </Button>
          )}
          <Button 
            variant="outline" 
            onClick={async () => {
              await saveCollection('subscribers', subscribers);
              toast.success('All subscribers saved permanently to disk!');
            }}
            className="gap-2 shadow-sm"
          >
            <Save className="h-4 w-4" /> Save Subscribers
          </Button>
          <Button onClick={() => setAddOpen(true)} className="gap-2 shadow">
            <Plus className="h-4 w-4" /> Add Subscriber
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
          </SelectContent>
        </Select>

        <Select value={zoneFilter} onValueChange={setZoneFilter}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Zone" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Zones</SelectItem>
            {zones.map(z => (
              <SelectItem key={z} value={z}>{z}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="pt-6">
          <DataTable
            columns={columns}
            data={filtered}
            searchKey="name"
            searchPlaceholder="Search subscriber by name..."
          />
        </CardContent>
      </Card>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add New Subscriber</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onAdd)} className="space-y-4 py-2">
            <div>
              <Label>Full Name</Label>
              <Input {...register('name')} placeholder="e.g. Asif Mahmud" />
              {errors.name && <p className="text-xs text-rose-500 mt-0.5">{errors.name.message}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Phone</Label>
                <Input {...register('phone')} placeholder="01711223344" />
                {errors.phone && <p className="text-xs text-rose-500 mt-0.5">{errors.phone.message}</p>}
              </div>
              <div>
                <Label>Email</Label>
                <Input {...register('email')} placeholder="asif@email.com" />
                {errors.email && <p className="text-xs text-rose-500 mt-0.5">{errors.email.message}</p>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Zone</Label>
                <Input {...register('zone')} placeholder="e.g. Mirpur" />
                {errors.zone && <p className="text-xs text-rose-500 mt-0.5">{errors.zone.message}</p>}
              </div>
              <div>
                <Label>Package</Label>
                <Controller
                  name="packageId"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select plan" />
                      </SelectTrigger>
                      <SelectContent>
                        {packages.map(p => (
                          <SelectItem key={p.id} value={p.id}>{p.name} - ৳{p.price}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {errors.packageId && <p className="text-xs text-rose-500 mt-0.5">{errors.packageId.message}</p>}
              </div>
            </div>
            <div>
              <Label>Installation Address</Label>
              <Input {...register('address')} placeholder="House 12, Road 4, Sector 7" />
              {errors.address && <p className="text-xs text-rose-500 mt-0.5">{errors.address.message}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button type="submit">Create Subscriber</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
