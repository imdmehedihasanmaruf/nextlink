'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  User,
  Mail,
  Phone,
  Save,
  Key,
  Check,
  AlertTriangle,
  LogOut,
  Lock,
  Shield,
  Building,
  RefreshCw,
  Trash2
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useAuthStore } from '@/store/authStore';

export default function AdminProfilePage() {
  const router = useRouter();
  const { user, isAuthenticated, hasHydrated, updateUser, logout } = useAuthStore();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [department, setDepartment] = useState('');
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [resetModalOpen, setResetModalOpen] = useState(false);

  useEffect(() => {
    if (hasHydrated && !isAuthenticated) {
      router.push('/login');
    }
  }, [hasHydrated, isAuthenticated, router]);

  useEffect(() => {
    if (user) {
      setName(user.name || '');
      setEmail(user.email || '');
      setPhone(user.phone || '+1 (800) 550-0001');
      setDepartment(user.department || 'Global Operations & Routing');
    }
  }, [user]);

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    updateUser({
      name,
      email,
      phone,
      department,
    });
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  const handleResetSession = () => {
    logout();
    router.push('/login');
  };

  if (!isAuthenticated || !user) {
    return null;
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Admin User Profile</h1>
          <p className="text-sm text-muted-foreground">
            Manage your ISP administrator credentials, notifications, and access keys.
          </p>
        </div>
        <Badge className="bg-primary/10 text-primary border-primary/30 px-3 py-1 font-bold text-xs uppercase self-start sm:self-auto">
          {user.role.replace('_', ' ')}
        </Badge>
      </div>

      {savedSuccess && (
        <div className="rounded-xl border border-emerald-500/50 bg-emerald-500/10 p-4 text-emerald-600 dark:text-emerald-400 flex items-center gap-2 animate-in fade-in">
          <Check className="h-5 w-5" />
          <span>Profile changes successfully updated and saved!</span>
        </div>
      )}

      {/* Header Info Card */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-white text-2xl font-black shadow-md">
              {name.charAt(0) || 'A'}
            </div>
            <div className="space-y-1">
              <h2 className="text-xl font-bold">{name}</h2>
              <p className="text-xs text-muted-foreground font-mono">
                Staff ID: <span className="text-foreground font-semibold">{user.id}</span> • Auth Email: <span className="text-foreground font-semibold">{email}</span>
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                {/* What this badge says is true for every staff account. The
                    MFA badge was removed because no MFA exists in the system. */}
                <Badge variant="outline" className="gap-1 text-xs">
                  <Lock size={12} className="text-emerald-500" /> Server-verified staff session
                </Badge>
                {/* The previous screen showed "Full Infrastructure Privileges"
                    to every staff member — including field technicians. It was
                    only ever true for super_admin, so that is when it shows. */}
                {String(user.role) === 'super_admin' ? (
                  <Badge variant="secondary" className="gap-1 text-xs">
                    <Shield size={12} className="text-primary" /> Full Infrastructure Privileges
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="gap-1 text-xs capitalize">
                    <Shield size={12} className="text-primary" /> {String(user.role).replace('_', ' ')} access — per role matrix
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Edit Details Form */}
      <form onSubmit={handleSaveProfile} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <User className="h-4 w-4 text-primary" /> Personal & Contact Details
            </CardTitle>
            <CardDescription className="text-xs">
              Update administrator display information and communication channels
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="name" className="text-xs">Full Name</Label>
                <Input 
                  id="name" 
                  value={name} 
                  onChange={(e) => setName(e.target.value)} 
                  required 
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-xs">Email Address</Label>
                <Input 
                  id="email" 
                  type="email" 
                  value={email} 
                  onChange={(e) => setEmail(e.target.value)} 
                  required 
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="phone" className="text-xs">Direct Emergency Hotline / Phone</Label>
                <Input 
                  id="phone" 
                  value={phone} 
                  onChange={(e) => setPhone(e.target.value)} 
                  required 
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="department" className="text-xs">Department / Unit</Label>
                <Input 
                  id="department" 
                  value={department} 
                  onChange={(e) => setDepartment(e.target.value)} 
                  required 
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <Button 
                type="button" 
                variant="outline"
                onClick={() => {
                  if (confirm('Delete saved contact information?')) {
                    setPhone('');
                    setDepartment('');
                    updateUser({ phone: '', department: '' });
                  }
                }}
                className="gap-1.5 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Delete Contact Info</span>
              </Button>
              <Button type="submit" className="gap-2 font-bold shadow">
                <Save className="h-4 w-4" />
                <span>Save Admin Profile</span>
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>

      {/* Security & Access Session */}
      <Card className="border border-destructive/20 bg-destructive/5">
        <CardHeader>
          <CardTitle className="text-base text-destructive flex items-center gap-2">
            <Lock className="h-4 w-4" /> Security & Session Management
          </CardTitle>
          <CardDescription className="text-xs">
            Manage your admin access token, revoke active browser sessions, or sign out.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1">
          <p className="text-xs text-muted-foreground">
            Invalidate current session cookies across all devices and require re-authentication.
          </p>
          <Button 
            variant="destructive" 
            onClick={() => setResetModalOpen(true)}
            className="gap-2 font-bold flex-shrink-0"
          >
            <LogOut className="h-4 w-4" />
            <span>Reset Active Session</span>
          </Button>
        </CardContent>
      </Card>

      {/* Reset Confirmation Dialog */}
      {resetModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <Card className="w-full max-w-md shadow-2xl border-2 animate-in zoom-in-95">
            <CardHeader className="text-center pb-2">
              <div className="h-12 w-12 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mx-auto mb-2">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <CardTitle className="text-lg font-bold">Reset Administrator Session?</CardTitle>
              <CardDescription className="text-xs">
                You will be immediately logged out and returned to the admin sign-in portal.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 pt-3">
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  onClick={() => setResetModalOpen(false)}
                  className="flex-1 font-semibold"
                >
                  Cancel
                </Button>
                <Button 
                  variant="destructive" 
                  onClick={handleResetSession}
                  className="flex-1 font-bold"
                >
                  Yes, Log Out Now
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
