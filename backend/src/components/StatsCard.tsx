'use client';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface StatsCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  className?: string;
  iconBg?: string;
}

export function StatsCard({
  title, value, subtitle, icon, trend, trendValue, className, iconBg = 'bg-primary/10',
}: StatsCardProps) {
  return (
    <Card className={cn('transition-all hover:shadow-md', className)}>
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="mt-1 text-2xl font-bold tracking-tight">{value}</p>
            {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
            {trend && trendValue && (
              <div className={cn('mt-2 flex items-center gap-1 text-xs font-medium', {
                'text-green-600': trend === 'up',
                'text-red-600': trend === 'down',
                'text-muted-foreground': trend === 'neutral',
              })}>
                {trend === 'up' && <TrendingUp className="h-3 w-3" />}
                {trend === 'down' && <TrendingDown className="h-3 w-3" />}
                {trend === 'neutral' && <Minus className="h-3 w-3" />}
                {trendValue}
              </div>
            )}
          </div>
          <div className={cn('rounded-lg p-3', iconBg)}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
