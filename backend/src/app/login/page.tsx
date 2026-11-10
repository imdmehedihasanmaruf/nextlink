'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Wifi, Eye, EyeOff, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useAuthStore } from '@/store/authStore';
import { apiLogin } from '@/lib/apiClient';
import type { UserRole } from '@/lib/mockData';

const schema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(4, 'Password required'),
});
type FormValues = z.infer<typeof schema>;

const authorizedStaff = [
  { email: 'admin@nextlink.com', passwords: ['admin', 'admin123'], role: 'super_admin' as UserRole, name: 'System Administrator' },
  { email: 'billing@nextlink.com', passwords: ['billing', 'billing123'], role: 'billing' as UserRole, name: 'Billing Manager' },
  { email: 'support@nextlink.com', passwords: ['support', 'support123'], role: 'support' as UserRole, name: 'Technical Support Lead' },
  { email: 'field@nextlink.com', passwords: ['field', 'field123'], role: 'technician' as UserRole, name: 'Field Technician' },
];

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuthStore();
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormValues) => {
    setLoading(true);
    await new Promise(r => setTimeout(r, 600));
    const account = authorizedStaff.find(a => a.email === data.email && a.passwords.includes(data.password));
    if (account) {
      login({ id: 'ADM-001', name: account.name, email: account.email, role: account.role });

      // Obtain a JWT for the NextLink Express API so the live Phase 3
      // features (billing engine, MikroTik, payments) are usable. The API may
      // be offline during local development — that must not block sign-in.
      const apiUser = await apiLogin(data.email, data.password);
      if (!apiUser) {
        toast('Signed in to the console. The NextLink API is offline — live automation is unavailable.', {
          icon: '⚠️',
        });
      }

      toast.success('Logged in successfully!');
      router.push('/dashboard');
    } else {
      toast.error('Invalid administrative credentials');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Logo */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-primary text-white mb-4 shadow-lg">
            <Wifi className="h-9 w-9" />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight">NextLink Global</h1>
          <p className="text-muted-foreground mt-1 text-sm font-medium">
            ISP Operations & Network Management
          </p>
        </div>

        <Card className="shadow-lg border">
          <CardHeader>
            <CardTitle className="text-xl">Admin Authentication</CardTitle>
            <CardDescription>
              Sign in with your authorized operational credentials
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Work Email</Label>
                <Input id="email" type="email" placeholder="admin@nextlink.com" {...register('email')} />
                {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input id="password" type={showPass ? 'text' : 'password'} placeholder="••••••••" {...register('password')} />
                  <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
              </div>
              <Button type="submit" className="w-full shadow font-semibold" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Sign In to Console
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
