'use client';

import { useEffect } from 'react';
import { Wrench, Phone, Mail, MapPin, CheckCircle, Clock, AlertCircle, Save, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { type Technician, type TechnicianStatus } from '@/lib/mockData';
import { useAdminDataStore } from '@/store/adminDataStore';

export default function TechniciansPage() {
  const t = (en: string, _bn?: string) => en;
  const { technicians, updateTechnicianStatus, deleteTechnician, clearCollection, saveCollection, fetchData } = useAdminDataStore();

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleStatusChange = async (id: string, status: TechnicianStatus) => {
    await updateTechnicianStatus(id, status);
    toast.success('Technician status updated and saved');
  };

  const getStatusBadge = (status: TechnicianStatus) => {
    if (status === 'available') return <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30">Available</Badge>;
    if (status === 'busy') return <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/30">On Field Job</Badge>;
    return <Badge variant="secondary">Off-Duty</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Field Technicians & Job Queue</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Regional fiber installation, ONT configurations, and physical line inspections.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            onClick={async () => {
              await saveCollection('technicians', technicians);
              toast.success('Technicians list saved permanently to disk!');
            }}
            className="gap-2 shadow-sm"
          >
            <Save className="h-4 w-4" /> Save Technicians
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {technicians.length === 0 ? (
          <div className="col-span-full py-12 text-center border-2 border-dashed rounded-xl border-border/60">
            <Wrench className="h-10 w-10 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm font-semibold text-muted-foreground">No Field Technicians Assigned</p>
            <p className="text-xs text-muted-foreground mt-1">Field engineers and fiber splicers will appear here.</p>
          </div>
        ) : (
          technicians.map((tech) => (
            <Card key={tech.id} className="border shadow-sm hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-muted-foreground">{tech.id}</span>
                  <div className="flex items-center gap-2">
                    {getStatusBadge(tech.status)}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        if (confirm(`Delete technician ${tech.name}?`)) {
                          await deleteTechnician(tech.id);
                          toast.success(`Technician ${tech.name} deleted`);
                        }
                      }}
                      className="h-7 w-7 p-0 text-rose-500 hover:text-rose-600 hover:bg-rose-50"
                      title="Delete Technician"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <CardTitle className="text-lg mt-2">{tech.name}</CardTitle>
                <CardDescription className="flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-primary" />
                  {tech.zone} Sector
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 pt-0">
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Phone className="h-4 w-4" />
                    <a href={`tel:${tech.phone}`} className="hover:text-primary">{tech.phone}</a>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Mail className="h-4 w-4" />
                    <span className="truncate">{tech.email}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 rounded-xl bg-muted/40 p-3 text-center">
                  <div>
                    <p className="text-xs text-muted-foreground">Active Jobs</p>
                    <p className="text-lg font-bold text-primary mt-1">{tech.activeJobs}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Completed</p>
                    <p className="text-lg font-bold text-emerald-600 mt-1">{tech.completedJobs}</p>
                  </div>
                </div>

                <div className="pt-2 border-t flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Status:</span>
                  <Select
                    value={tech.status}
                    onValueChange={(val: TechnicianStatus) => handleStatusChange(tech.id, val)}
                  >
                    <SelectTrigger className="w-36 h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="available">Available</SelectItem>
                      <SelectItem value="busy">Busy / On-Job</SelectItem>
                      <SelectItem value="off-duty">Off-Duty</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
