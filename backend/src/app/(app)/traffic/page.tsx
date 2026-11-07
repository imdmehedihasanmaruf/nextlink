'use client';
import { useState, useEffect } from 'react';
import { 
  Activity, Save, Plus, Trash2, Download, Upload, 
  Wifi, Cpu, Server, CheckCircle2, RefreshCw, HardDrive
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useAdminDataStore } from '@/store/adminDataStore';

export default function InterfaceTrafficPage() {
  const { interfaceTraffic, saveItem, fetchData } = useAdminDataStore();
  const [loading, setLoading] = useState(false);

  // Configuration State
  const [allocatedSpeed, setAllocatedSpeed] = useState(500);
  const [downloadRateMbps, setDownloadRateMbps] = useState(498.2);
  const [uploadRateMbps, setUploadRateMbps] = useState(494.7);
  const [consumedDataGB, setConsumedDataGB] = useState('648.2 GB');
  const [totalQuota, setTotalQuota] = useState('Unlimited Symmetrical');
  const [gatewayIPv4, setGatewayIPv4] = useState('198.51.100.12');
  const [gatewayIPv6, setGatewayIPv6] = useState('2001:db8:85a3::8a2e:370:7334');
  const [oltPort, setOltPort] = useState('2/1/4');
  const [terminalStatus, setTerminalStatus] = useState('Synchronized');
  const [interfaces, setInterfaces] = useState<any[]>([]);

  // Add Interface Modal
  const [dialogOpen, setDialogOpen] = useState(false);
  const [ifName, setIfName] = useState('');
  const [ifType, setIfType] = useState('Gigabit Ethernet');
  const [ifRx, setIfRx] = useState('500 Mbps');
  const [ifTx, setIfTx] = useState('500 Mbps');

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (interfaceTraffic) {
      setAllocatedSpeed(interfaceTraffic.allocatedSpeed ?? 500);
      setDownloadRateMbps(interfaceTraffic.downloadRateMbps ?? 498.2);
      setUploadRateMbps(interfaceTraffic.uploadRateMbps ?? 494.7);
      setConsumedDataGB(interfaceTraffic.consumedDataGB || '648.2 GB');
      setTotalQuota(interfaceTraffic.totalQuota || 'Unlimited Symmetrical');
      setGatewayIPv4(interfaceTraffic.gatewayIPv4 || '198.51.100.12');
      setGatewayIPv6(interfaceTraffic.gatewayIPv6 || '2001:db8:85a3::8a2e:370:7334');
      setOltPort(interfaceTraffic.oltPort || '2/1/4');
      setTerminalStatus(interfaceTraffic.terminalStatus || 'Synchronized');
      setInterfaces(Array.isArray(interfaceTraffic.interfaces) ? interfaceTraffic.interfaces : []);
    }
  }, [interfaceTraffic]);

  const handleSave = async (updatedInterfaces?: any[]) => {
    setLoading(true);
    const activeList = updatedInterfaces !== undefined ? updatedInterfaces : interfaces;
    const payload = {
      allocatedSpeed: Number(allocatedSpeed),
      downloadRateMbps: Number(downloadRateMbps),
      uploadRateMbps: Number(uploadRateMbps),
      consumedDataGB,
      totalQuota,
      gatewayIPv4,
      gatewayIPv6,
      oltPort,
      terminalStatus,
      interfaces: activeList,
    };

    await saveItem('interfaceTraffic', payload);
    setLoading(false);
    toast.success('Bandwidth & Traffic metrics saved & synced to Frontend Portal!');
  };

  const handleAddInterface = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ifName.trim()) return;

    const newIf = {
      id: `IF-${Date.now().toString().slice(-4)}`,
      name: ifName,
      type: ifType,
      rx: ifRx,
      tx: ifTx,
      status: 'Up',
    };

    const updated = [...interfaces, newIf];
    setInterfaces(updated);
    setDialogOpen(false);
    setIfName('');
    await handleSave(updated);
  };

  const handleDeleteInterface = async (id: string) => {
    if (confirm('Delete this optical/physical interface?')) {
      const updated = interfaces.filter(i => i.id !== id);
      setInterfaces(updated);
      await handleSave(updated);
      toast.success('Interface removed!');
    }
  };

  const handleClearInterfaces = async () => {
    if (confirm('Clear all interface logs?')) {
      setInterfaces([]);
      await handleSave([]);
      toast.success('All interfaces cleared!');
    }
  };

  const handleResetDefaults = () => {
    if (confirm('Reset Bandwidth & Interface metrics to standard GPON profile?')) {
      const defaultIfs = [
        { id: 'IF-1', name: 'sfp-sfpplus1 (Uplink)', type: 'Optical 10G SFP+', rx: '4.82 Gbps', tx: '3.91 Gbps', status: 'Up' },
        { id: 'IF-2', name: 'ether1-gateway (Client Drop)', type: 'Gigabit Ethernet', rx: '498.2 Mbps', tx: '494.7 Mbps', status: 'Up' },
        { id: 'IF-3', name: 'gpon-olt-port (Fiber PON)', type: 'GPON ITU-T G.984', rx: '1.24 Gbps', tx: '1.18 Gbps', status: 'Up' },
      ];
      setAllocatedSpeed(500);
      setDownloadRateMbps(498.2);
      setUploadRateMbps(494.7);
      setConsumedDataGB('648.2 GB');
      setTotalQuota('Unlimited Symmetrical');
      setGatewayIPv4('198.51.100.12');
      setGatewayIPv6('2001:db8:85a3::8a2e:370:7334');
      setOltPort('2/1/4');
      setTerminalStatus('Synchronized');
      setInterfaces(defaultIfs);
      handleSave(defaultIfs);
      toast.success('GPON defaults restored!');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2.5">
            <Activity className="h-6 w-6 text-primary" />
            Bandwidth Consumption & Interface Traffic
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure live GPON throughput telemetry, interface packet counters, and gateway IPv4/IPv6 routing endpoints.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleResetDefaults} className="gap-1.5 text-xs text-rose-600 border-rose-200 hover:bg-rose-50">
            <Trash2 className="h-3.5 w-3.5" />
            Reset Defaults
          </Button>
          <Button onClick={() => handleSave()} disabled={loading} className="gap-1.5 shadow">
            {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save & Sync Frontend
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-emerald-500/20 bg-emerald-500/5 shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-bold text-emerald-700 dark:text-emerald-400">Live Download Throughput</CardDescription>
            <CardTitle className="text-2xl font-extrabold text-emerald-600 font-mono flex items-center gap-2">
              <Download className="h-5 w-5" />
              {downloadRateMbps} Mbps
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Allocated: {allocatedSpeed} Mbps Symmetrical</p>
          </CardContent>
        </Card>

        <Card className="border-blue-500/20 bg-blue-500/5 shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-bold text-blue-700 dark:text-blue-400">Live Upload Throughput</CardDescription>
            <CardTitle className="text-2xl font-extrabold text-blue-600 font-mono flex items-center gap-2">
              <Upload className="h-5 w-5" />
              {uploadRateMbps} Mbps
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Direct Tier-1 cloud peering</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-bold">Billing Cycle Consumed</CardDescription>
            <CardTitle className="text-2xl font-extrabold font-mono">{consumedDataGB}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Quota: {totalQuota}</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-bold">Optical Terminal Status</CardDescription>
            <CardTitle className="text-lg font-bold text-foreground">OLT Port {oltPort}</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 text-xs">
              {terminalStatus}
            </Badge>
          </CardContent>
        </Card>
      </div>

      {/* Configuration Form Card */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Cpu className="h-4 w-4 text-primary" />
            Bandwidth Allocation & Gateway Routing Parameters
          </CardTitle>
          <CardDescription>Adjust throughput metrics displayed on the frontend subscriber portal card</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-2">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <Label className="text-xs">Allocated Bandwidth (Mbps)</Label>
              <Input
                type="number"
                value={allocatedSpeed}
                onChange={(e) => setAllocatedSpeed(Number(e.target.value))}
                className="mt-1 font-bold"
              />
            </div>
            <div>
              <Label className="text-xs">Live Download Rate (Mbps)</Label>
              <Input
                type="number"
                step="0.1"
                value={downloadRateMbps}
                onChange={(e) => setDownloadRateMbps(Number(e.target.value))}
                className="mt-1 font-mono"
              />
            </div>
            <div>
              <Label className="text-xs">Live Upload Rate (Mbps)</Label>
              <Input
                type="number"
                step="0.1"
                value={uploadRateMbps}
                onChange={(e) => setUploadRateMbps(Number(e.target.value))}
                className="mt-1 font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs">Data Consumed Label</Label>
              <Input
                value={consumedDataGB}
                onChange={(e) => setConsumedDataGB(e.target.value)}
                placeholder="e.g. 648.2 GB"
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Total Data Quota Text</Label>
              <Input
                value={totalQuota}
                onChange={(e) => setTotalQuota(e.target.value)}
                placeholder="e.g. Unlimited Symmetrical"
                className="mt-1"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 pt-2 border-t">
            <div>
              <Label className="text-xs">Gateway IPv4 Address</Label>
              <Input
                value={gatewayIPv4}
                onChange={(e) => setGatewayIPv4(e.target.value)}
                className="font-mono text-xs mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Gateway IPv6 Subnet</Label>
              <Input
                value={gatewayIPv6}
                onChange={(e) => setGatewayIPv6(e.target.value)}
                className="font-mono text-xs mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">OLT Port Designation</Label>
              <Input
                value={oltPort}
                onChange={(e) => setOltPort(e.target.value)}
                className="font-mono text-xs mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Terminal Sync Status</Label>
              <Input
                value={terminalStatus}
                onChange={(e) => setTerminalStatus(e.target.value)}
                className="text-xs mt-1"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Optical Interfaces Table */}
      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Server className="h-4 w-4 text-primary" />
              Active Hardware & Optical Interfaces
            </CardTitle>
            <CardDescription>Monitored physical ports, SFP+ links, and GPON drops</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleClearInterfaces} className="gap-1.5 text-xs text-rose-600 hover:bg-rose-50 border-rose-200">
              <Trash2 className="h-3.5 w-3.5" />
              Clear Interfaces
            </Button>
            <Button size="sm" onClick={() => setDialogOpen(true)} className="gap-1.5 text-xs">
              <Plus className="h-3.5 w-3.5" />
              Add Interface
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {interfaces.length === 0 ? (
            <div className="py-8 text-center border border-dashed rounded-xl">
              <p className="text-sm font-semibold text-muted-foreground">No Interfaces Configured</p>
              <p className="text-xs text-muted-foreground mt-1">Click "Add Interface" or "Reset Defaults" above.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground text-left">
                    <th className="py-2.5 px-3">Interface Name</th>
                    <th className="py-2.5 px-3">Medium / Port Type</th>
                    <th className="py-2.5 px-3">Rx Rate</th>
                    <th className="py-2.5 px-3">Tx Rate</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3 text-right">Delete</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {interfaces.map((ifItem) => (
                    <tr key={ifItem.id} className="hover:bg-muted/40 transition-colors">
                      <td className="py-2.5 px-3 font-semibold text-foreground font-mono">{ifItem.name}</td>
                      <td className="py-2.5 px-3 text-xs text-muted-foreground">{ifItem.type}</td>
                      <td className="py-2.5 px-3 font-mono text-xs font-semibold text-emerald-600">{ifItem.rx}</td>
                      <td className="py-2.5 px-3 font-mono text-xs font-semibold text-blue-600">{ifItem.tx}</td>
                      <td className="py-2.5 px-3">
                        <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 text-xs">
                          {ifItem.status || 'Up'}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDeleteInterface(ifItem.id)}
                          className="h-8 w-8 p-0 text-rose-500 hover:text-rose-600 hover:bg-rose-50"
                          title="Delete interface"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Interface Modal */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Network / Optical Interface</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddInterface} className="space-y-4 pt-2">
            <div>
              <Label>Interface Name *</Label>
              <Input
                value={ifName}
                onChange={(e) => setIfName(e.target.value)}
                placeholder="e.g. sfp-sfpplus2 (Secondary Ring)"
                required
              />
            </div>
            <div>
              <Label>Medium / Port Type</Label>
              <Input
                value={ifType}
                onChange={(e) => setIfType(e.target.value)}
                placeholder="e.g. Optical 10G SFP+ / GPON"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Rx Rate</Label>
                <Input
                  value={ifRx}
                  onChange={(e) => setIfRx(e.target.value)}
                  placeholder="e.g. 1.2 Gbps"
                />
              </div>
              <div>
                <Label>Tx Rate</Label>
                <Input
                  value={ifTx}
                  onChange={(e) => setIfTx(e.target.value)}
                  placeholder="e.g. 1.1 Gbps"
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit">Add Interface</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
